import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { ingestSchema, eventSchema, resolutionSchema, PipelineError, type IngestInput } from "./contracts";
import { llmOptionsFromEnv } from "../interpretation/config";
import { createInterpreter, type Interpreter } from "../interpretation/interpreter";
import { createRouter, type Router, type RouteDecision } from "./routing";
import type { InterpretationDecision } from "../interpretation/validate";
import { createQuoteInputSchema } from "../quotes/schemas";

type Tx = Prisma.TransactionClient;
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, canonical(entry)]));
  }
  return value;
}
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
const includeQuote = { lines: { orderBy: { sku: "asc" as const } }, conversations: { orderBy: { conversationId: "asc" as const } } };
type FullQuote = Prisma.QuoteGetPayload<{ include: typeof includeQuote }>;
export function serializeQuote(quote: FullQuote) {
  return { document_type: "Oferta_de_Venta", quote_id: quote.id, status: quote.status,
    conversations: quote.conversations.map(c => c.conversationId),
    line_items: quote.lines.map(l => ({ sku: l.sku, qty: l.quantity })) };
}
async function lock(tx: Tx, customerId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`axial:${customerId}`}))`;
}
async function conversation(tx: Tx, id: string, customerId: string) {
  const existing = await tx.conversation.findUnique({ where: { id } });
  if (existing && existing.customerId !== customerId) throw new PipelineError(409, "Conversation belongs to another customer.");
  return existing ?? tx.conversation.create({ data: { id, customerId } });
}
async function activity(tx: Tx, quoteId: string, customerId: string, action: string, sourceIds: string[], after: unknown, before?: unknown, reason?: string) {
  const record = await tx.quoteActivity.create({ data: {
    quoteId, customerId, action, afterState: json(after), ...(before === undefined ? {} : { beforeState: json(before) }), reason,
  } });
  await tx.quoteActivityMessage.createMany({ data: [...new Set(sourceIds)].map(messageId => ({ activityId: record.id, messageId, customerId })) });
  return record;
}
async function link(tx: Tx, quoteId: string, conversationId: string, customerId: string, sourceIds: string[]) {
  const existing = await tx.quoteConversation.findUnique({ where: { quoteId_conversationId: { quoteId, conversationId } } });
  if (!existing) {
    await tx.quoteConversation.create({ data: { quoteId, conversationId, customerId } });
    await activity(tx, quoteId, customerId, "conversation_linked", sourceIds, { conversationId });
  }
}
async function createQuote(tx: Tx, customerId: string, conversationId: string, lines: { sku: string; quantity: number }[], sourceIds: string[]) {
  createQuoteInputSchema.parse({ customerId, lines });
  const quote = await tx.quote.create({ data: { customerId, lines: { create: lines } } });
  await activity(tx, quote.id, customerId, "quote_created", sourceIds, { lines });
  await link(tx, quote.id, conversationId, customerId, sourceIds);
  return quote.id;
}
function existingBootstrap(existing: { customerId: string; bootstrapHash: string | null; bootstrapResponse: Prisma.JsonValue | null } | null, input: IngestInput, digest: string) {
  if (!existing) return undefined;
  if (existing.customerId !== input.customer_id) throw new PipelineError(409, "Conversation belongs to another customer.");
  if (existing.bootstrapHash && existing.bootstrapHash !== digest) throw new PipelineError(409, "History already ingested; send subsequent messages individually.");
  return existing.bootstrapHash === digest && existing.bootstrapResponse ? existing.bootstrapResponse : undefined;
}

export class QuotePipeline {
  constructor(private db: PrismaClient, private interpret: Interpreter = createInterpreter(llmOptionsFromEnv()), private route: Router = createRouter(llmOptionsFromEnv())) {}

  async ingest(raw: unknown) {
    const input = ingestSchema.parse(raw);
    const digest = hash(input);
    const previous = existingBootstrap(await this.db.conversation.findUnique({ where: { id: input.conversation_id } }), input, digest);
    if (previous !== undefined) return previous;
    const catalog = await this.db.catalogItem.findMany();
    let decision: InterpretationDecision;
    try { decision = await this.interpret(input.conversation_history, catalog); }
    catch {
      // Persist the original evidence for review, but never commit model errors as quote lines.
      decision = { status: "needs_clarification", reason: "unresolved_items", interpretation: { items: [], unresolved: [{ description: "Conversation interpretation failed", reason: "Interpreter unavailable or returned invalid output; human review required.", sourceMessageIndexes: input.conversation_history.map((_, i) => i) }] } };
    }
    return this.db.$transaction(async tx => {
      await lock(tx, input.customer_id);
      const existing = await conversation(tx, input.conversation_id, input.customer_id);
      const replay = existingBootstrap(existing, input, digest);
      if (replay !== undefined) return replay;
      const messages = [];
      for (const message of input.conversation_history) {
        messages.push(await tx.message.create({ data: { conversationId: input.conversation_id, customerId: input.customer_id,
          direction: message.direction, timestamp: new Date(message.timestamp), text: message.text,
          processingStatus: decision.status === "ready" ? "processed" : "needs_clarification",
          processingReason: decision.status === "ready" ? null : JSON.stringify(decision.interpretation.unresolved),
        } }));
      }
      let result: unknown;
      if (decision.status === "ready") {
        const sourceIds = [...new Set(decision.interpretation.items.flatMap(i => i.sourceMessageIndexes))].map(i => messages[i].id);
        const id = await createQuote(tx, input.customer_id, input.conversation_id,
          decision.interpretation.items.map(({ sku, quantity }) => ({ sku, quantity })), sourceIds);
        result = serializeQuote(await tx.quote.findUniqueOrThrow({ where: { id }, include: includeQuote }));
      } else {
        result = { status: "needs_clarification", reason: decision.reason, unresolved: decision.interpretation.unresolved, message_ids: messages.map(m => m.id), candidates: [] };
      }
      await tx.conversation.update({ where: { id: input.conversation_id }, data: { bootstrapHash: digest, bootstrapResponse: json(result) } });
      return json(result);
    }, { timeout: 10000 });
  }

  async message(raw: unknown) {
    const input = eventSchema.parse(raw);
    const digest = hash(input);
    return this.db.$transaction(async tx => {
      await lock(tx, input.customer_id);
      const existing = await tx.message.findUnique({ where: { externalId: input.message_id } });
      if (existing) {
        if (existing.customerId !== input.customer_id || existing.requestHash !== digest) throw new PipelineError(409, "Message ID reused with different content.");
        return existing.result;
      }
      await conversation(tx, input.conversation_id, input.customer_id);
      const message = await tx.message.create({ data: { externalId: input.message_id, requestHash: digest, conversationId: input.conversation_id,
        customerId: input.customer_id, direction: input.direction, timestamp: new Date(input.timestamp), text: input.text } });
      const quotes = await tx.quote.findMany({ where: { customerId: input.customer_id, status: "draft" }, include: { lines: true }, orderBy: { createdAt: "asc" } });
      const catalog = await tx.catalogItem.findMany();
      let decision: RouteDecision | null = null;
      if (input.direction === "inbound") {
        try { decision = await this.route(input.text, quotes, catalog); }
        catch { decision = { action: "clarify", reason: "Message interpretation failed; human review required.", candidates: quotes.map(q => q.id) }; }
      }
      let result: unknown;
      if (!decision) {
        result = { status: "recorded", message_id: message.id };
      } else if (decision.action === "clarify") {
        result = { status: "needs_clarification", message_id: message.id, reason: decision.reason, candidates: decision.candidates };
        await tx.message.update({ where: { id: message.id }, data: { processingStatus: "needs_clarification", processingReason: decision.reason, candidateQuoteIds: decision.candidates, result: json(result) } });
        return json(result);
      } else {
        let quoteId: string;
        if (decision.action === "create") {
          quoteId = await createQuote(tx, input.customer_id, input.conversation_id, [{ sku: decision.sku, quantity: decision.quantity }], [message.id]);
        } else {
          quoteId = decision.quoteId;
          const later = await tx.quoteActivityMessage.findFirst({ where: { activity: { quoteId }, message: { timestamp: { gt: new Date(input.timestamp) } } } });
          if (later) {
            result = { status: "needs_clarification", message_id: message.id, reason: "Message predates quote evidence; review ordering before applying.", candidates: [quoteId] };
            await tx.message.update({ where: { id: message.id }, data: { processingStatus: "needs_clarification", processingReason: "Out-of-order message", candidateQuoteIds: [quoteId], result: json(result) } });
            return json(result);
          }
          if (decision.action === "revise") {
            const before = await tx.quoteLine.findUniqueOrThrow({ where: { quoteId_sku: { quoteId, sku: decision.sku } } });
            await tx.quoteLine.update({ where: { quoteId_sku: { quoteId, sku: decision.sku } }, data: { quantity: decision.quantity } });
            await tx.quote.update({ where: { id: quoteId }, data: { updatedAt: new Date() } });
            await activity(tx, quoteId, input.customer_id, "quantity_changed", [message.id], { sku: decision.sku, quantity: decision.quantity }, { sku: before.sku, quantity: before.quantity }, "LLM selected an existing customer quote and line; structural constraints validated.");
          }
          await link(tx, quoteId, input.conversation_id, input.customer_id, [message.id]);
        }
        result = { status: "processed", action: decision.action, quote: serializeQuote(await tx.quote.findUniqueOrThrow({ where: { id: quoteId }, include: includeQuote })) };
      }
      await tx.message.update({ where: { id: message.id }, data: { processingStatus: "processed", result: json(result) } });
      return json(result);
    }, { timeout: 30000 });
  }

  async quotes(customerId: string) {
    const quotes = await this.db.quote.findMany({ where: { customerId }, include: includeQuote, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    return { quotes: quotes.map(serializeQuote) };
  }
  async history(quoteId: string, customerId: string) {
    const quote = await this.db.quote.findFirst({ where: { id: quoteId, customerId } });
    if (!quote) throw new PipelineError(404, "Quote not found.");
    return { activities: await this.db.quoteActivity.findMany({ where: { quoteId, customerId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], include: { sources: { include: { message: true } } } }) };
  }
  async unresolved(customerId: string) {
    const messages = await this.db.message.findMany({ where: { customerId, processingStatus: "needs_clarification" }, orderBy: [{ receivedAt: "asc" }, { id: "asc" }] });
    return { messages: await Promise.all(messages.map(async message => ({ message_id: message.id, external_id: message.externalId, conversation_id: message.conversationId,
      text: message.text, reason: message.processingReason,
      candidates: (await this.db.quote.findMany({ where: { id: { in: message.candidateQuoteIds }, customerId }, include: includeQuote })).map(serializeQuote),
    }))) };
  }
  async resolve(messageId: string, raw: unknown) {
    const input = resolutionSchema.parse(raw);
    return this.db.$transaction(async tx => {
      await lock(tx, input.customer_id);
      const message = await tx.message.findFirst({ where: { id: messageId, customerId: input.customer_id } });
      if (!message) throw new PipelineError(404, "Message not found.");
      if (message.resolution) {
        const previous = message.resolution as { request: unknown; result: Prisma.JsonValue };
        if (hash(previous.request) !== hash(input)) throw new PipelineError(409, "Message already resolved differently.");
        return previous.result;
      }
      if (message.processingStatus !== "needs_clarification") throw new PipelineError(409, "Message is not awaiting review.");
      let result: unknown = { status: "dismissed", message_id: message.id };
      if (input.action === "cancel_quote") {
        if (!message.candidateQuoteIds.includes(input.quote_id)) throw new PipelineError(409, "Select a candidate from this review request.");
        const quote = await tx.quote.findFirst({ where: { id: input.quote_id, customerId: input.customer_id, status: "draft" } });
        if (!quote) throw new PipelineError(409, "Candidate is no longer a draft quote.");
        await tx.quote.update({ where: { id: quote.id }, data: { status: "cancelled" } });
        await activity(tx, quote.id, input.customer_id, "quote_cancelled", [message.id], { status: "cancelled" }, { status: "draft" }, "Explicit human selection via local review API.");
        await link(tx, quote.id, message.conversationId, input.customer_id, [message.id]);
        result = { status: "resolved", quote: serializeQuote(await tx.quote.findUniqueOrThrow({ where: { id: quote.id }, include: includeQuote })) };
      }
      await tx.message.update({ where: { id: messageId }, data: { processingStatus: "processed", resolution: json({ request: input, result }) } });
      return json(result);
    }, { timeout: 10000 });
  }
}
