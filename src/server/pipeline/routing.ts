import type { CatalogEntry } from "./contracts";
import { normalize, productCandidates, compatible } from "../interpretation/products";
import { interpretWithRules } from "../interpretation/rules";
export type QuoteCandidate = { id: string; lines: { sku: string; quantity: number }[] };
export type RouteDecision =
  | { action: "create"; sku: string; quantity: number }
  | { action: "revise"; quoteId: string; sku: string; quantity: number }
  | { action: "inspect"; quoteId: string }
  | { action: "clarify"; reason: string; candidates: string[] };

export function routeMessage(text: string, quotes: QuoteCandidate[], catalog: CatalogEntry[]): RouteDecision {
  const t = normalize(text);
  const clarify = (reason: string, candidates = quotes.map(q => q.id)): RouteDecision => ({ action: "clarify", reason, candidates });
  if (/cancel/.test(t)) return clarify("Select the quote to cancel; no automatic cancellation is permitted.");
  if (/\bno\s+(?:camb|modifi|cotiz)/.test(t)) return clarify("Negated request requires clarification.");
  const products = productCandidates(t, catalog).filter(p => compatible(t, p));
  const skus = new Set(products.map(p => p.sku));
  if (/\baparte\b/.test(t) && /cotiz/.test(t)) {
    const parsed = interpretWithRules([{ direction: "inbound", text }], catalog);
    if (parsed.unresolved.length || parsed.items.length !== 1 || !validQty(parsed.items[0].quantity)) {
      return clarify("Separate request needs one fully resolved product and a positive integer quantity.");
    }
    return { action: "create", sku: parsed.items[0].sku, quantity: parsed.items[0].quantity };
  }
  const matchingQuotes = quotes.filter(q => q.lines.some(l => skus.has(l.sku)));
  const revisions = [...t.matchAll(/\b(?:sean|sea|dejalo en|cambialo a)\s+(\d+)\b(?![.,]\d)/g)];
  if (revisions.length > 1) return clarify("Multiple revisions require clarification before any line changes.");
  const revision = revisions[0];
  if (revision && /mejor|cambia|dejalo/.test(t)) {
    const old = t.match(/\bno\s+(\d+)\b/);
    const lines = matchingQuotes.flatMap(q => q.lines.filter(l => skus.has(l.sku) && (!old || l.quantity === Number(old[1]))).map(l => ({ ...l, quoteId: q.id })));
    const qty = Number(revision[1]);
    if (lines.length !== 1 || !validQty(qty)) return clarify("Revision does not identify exactly one line with a valid quantity.", matchingQuotes.map(q => q.id));
    return { action: "revise", quoteId: lines[0].quoteId, sku: lines[0].sku, quantity: qty };
  }
  if (/confirm|que lleva|que incluye/.test(t)) {
    if (matchingQuotes.length === 1) return { action: "inspect", quoteId: matchingQuotes[0].id };
    return clarify("Question does not identify exactly one quote.", matchingQuotes.map(q => q.id));
  }
  return clarify("Message requires clarification before a quote can be changed.", matchingQuotes.length ? matchingQuotes.map(q => q.id) : undefined);
}
function validQty(qty: number) { return Number.isSafeInteger(qty) && qty > 0 && qty <= 2147483647; }
