import type { CatalogEntry, HistoryMessage } from "../pipeline/contracts";
import type { Interpretation } from "./schema";
import { compatible, normalize, productCandidates } from "./products";

export function interpretWithRules(history: readonly Pick<HistoryMessage, "direction" | "text">[], catalog: readonly CatalogEntry[]): Interpretation {
  const result: Interpretation = { items: [], unresolved: [] };
  let pending: { candidates: CatalogEntry[]; indexes: number[]; description: string; clarified: boolean } | undefined;
  const unresolved = (description: string, reason: string, indexes: number[]) => result.unresolved.push({ description, reason, sourceMessageIndexes: indexes });
  const add = (item: CatalogEntry, quantity: number, indexes: number[]) => {
    if (result.items.some(line => line.sku === item.sku)) {
      unresolved(item.description, "Repeated product: clarify replacement versus additional quantity.", indexes);
    } else result.items.push({ sku: item.sku, quantity, sourceMessageIndexes: [...new Set(indexes)] });
  };
  for (const [index, message] of history.entries()) {
    const text = normalize(message.text);
    if (message.direction === "inbound" && /\bno\s+(?:quiero|necesito|cotices|cotiz|camb)/.test(text)) {
      unresolved(message.text, "Negated request requires interpretation beyond local rules.", [index]);
      continue;
    }
    if (message.direction === "outbound") {
      if (pending) {
        const mentioned = productCandidates(text, catalog);
        const matching = mentioned.length ? pending.candidates.filter(p => mentioned.some(m => m.sku === p.sku)) : pending.candidates;
        if (matching.length) pending.indexes.push(index);
        if (/\bno\b|\bagotad|\bsin existencias/.test(text)) {
          pending.clarified = false;
          continue;
        }
        if (/\d+(?:\.\d+)?\s*x\s*\d+/.test(text) && /(?:seria|disponible|tenemos|solo)/.test(text)) {
          pending.candidates = matching.filter(p => compatible(text, p));
          pending.clarified = pending.candidates.length === 1;
        }
      }
      continue;
    }
    if (pending && /^(?:necesitamos|quiero|serian|son)\s+\d+\s+(?:rollos?|piezas?)\.?$/.test(text)) {
      const quantity = Number(text.match(/\d+/)![0]);
      if (pending.clarified && pending.candidates.length === 1) add(pending.candidates[0], quantity, [...pending.indexes, index]);
      else unresolved(pending.description, "Product or available dimensions are not unambiguous.", [...pending.indexes, index]);
      pending = undefined;
      continue;
    }
    let understood = false;
    const clauses = text.split(/,\s*|\s+y\s+(?=si\b|\d+\s+\p{L})/u);
    for (const clause of clauses) {
      const candidates = productCandidates(clause, catalog);
      const quantityMatch = clause.match(/(?<![\d.,-])\b(\d+)\s+(?:(?:rollos?|piezas?|laminas?)\s+(?:de\s+)?)?(?:lonas?|mesh|microperforad\w*|acrilic\w*|vinil\w*|[a-z]+-[a-z0-9-]+)/);
      if (quantityMatch) {
        understood = true;
        let selected = candidates;
        // In the supplied sales vocabulary an unqualified "lona" request is frontlit; mesh is named explicitly.
        if (/\blonas?\b/.test(clause) && !/mesh/.test(clause)) selected = selected.filter(p => !/mesh/i.test(p.description));
        selected = selected.filter(p => compatible(clause, p));
        if (selected.length === 1) add(selected[0], Number(quantityMatch[1]), [index]);
        else unresolved(clause, "Requested product or dimensions do not uniquely match the catalog.", [index]);
      } else if (candidates.length) {
        understood = true;
        if (pending) unresolved(pending.description, "Requested quantity or product remains unresolved.", pending.indexes);
        pending = { candidates, indexes: [index], description: clause, clarified: candidates.length === 1 && compatible(clause, candidates[0]) };
      } else if (/\d+\s+\p{L}|\b(?:cotiza|quiero|necesito)/u.test(clause)) {
        understood = true;
        unresolved(clause, "Request is outside the supported local vocabulary.", [index]);
      }
    }
    if (!understood && !/^(hola|buenos? dias?|buen dia|gracias|ok)[.! ]*$/.test(text)) {
      unresolved(message.text, "Cannot safely interpret this message with local rules.", [index]);
    }
  }
  if (pending) unresolved(pending.description, "Clarify the requested product and quantity.", pending.indexes);
  return result;
}
