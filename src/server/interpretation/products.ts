import type { CatalogEntry } from "../pipeline/contracts";
export const normalize = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

// Small vocabulary for this four-product catalog; never returns a SKU absent from the supplied DB catalog.
export function productCandidates(text: string, catalog: readonly CatalogEntry[]): CatalogEntry[] {
  const t = normalize(text);
  const exact = catalog.filter(item => t.includes(item.sku.toLowerCase()));
  if (exact.length) return exact;
  const matches = catalog.filter(item => {
    const d = normalize(item.description);
    if (/acrilic/.test(t) && /acrilic/.test(d)) return true;
    if (/microperforad/.test(t) && /microperforad/.test(d)) return true;
    if (/mesh/.test(t) && /mesh/.test(d)) return true;
    if (/frontlit/.test(t) && /frontlit/.test(d)) return true;
    if (/\blonas?\b/.test(t) && /\blona\b/.test(d)) return true;
    return false;
  });
  return matches;
}

// Explicit incompatible dimensions must not be silently mapped to the sole product in a family.
export function compatible(text: string, item: CatalogEntry): boolean {
  const t = normalize(text).replace(/,/g, ".");
  const d = normalize(item.description);
  const dimensions = [...t.matchAll(/\b(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/g)];
  if (dimensions.some(m => !d.includes(`${Number(m[1]).toFixed(2)}x${m[2]}`) &&
      !d.includes(`${m[1]}x${m[2]}`))) return false;
  const thickness = t.match(/\b(\d+)\s*mm\b/);
  if (thickness && !d.includes(`${thickness[1]}mm`)) return false;
  if (/acrilic/.test(t) && /\b(rojo|negro|transparente)\b/.test(t) && /blanco/.test(d)) return false;
  if (/microperforad/.test(t)) {
    const widths = [...t.matchAll(/\b1\.\d+\b/g)].map(m => m[0]);
    if (widths.some(width => !d.includes(width))) return false;
  }
  return true;
}
