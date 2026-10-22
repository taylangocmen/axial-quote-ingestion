import { z } from "zod";

export const identifierSchema = z.string().trim().min(1).max(200);
const id = identifierSchema;
export const historyMessageSchema = z.object({
  direction: z.enum(["inbound", "outbound"]),
  timestamp: z.iso.datetime({ offset: true }),
  text: z.string().trim().min(1).max(10000),
}).strict();
export const ingestSchema = z.object({
  customer_id: id,
  conversation_id: id,
  customer_name: z.string().max(300).optional(),
  conversation_history: z.array(historyMessageSchema).min(1).max(100),
}).strict().refine(({ conversation_history: history }) => history.every((m, i) =>
  i === 0 || Date.parse(m.timestamp) >= Date.parse(history[i - 1].timestamp)),
{ message: "History must be chronological; indexes refer to the supplied order." });
export const eventSchema = historyMessageSchema.extend({
  message_id: id, customer_id: id, conversation_id: id,
});
export const resolutionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("cancel_quote"), customer_id: id, quote_id: id }).strict(),
  z.object({ action: z.literal("dismiss"), customer_id: id }).strict(),
]);
export type HistoryMessage = z.infer<typeof historyMessageSchema>;
export type IngestInput = z.infer<typeof ingestSchema>;
export type EventInput = z.infer<typeof eventSchema>;
export type CatalogEntry = { sku: string; description: string };
export class PipelineError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
