import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { CatalogEntry, IngestInput, EventInput } from "../src/server/pipeline/contracts";
export const initial = JSON.parse(readFileSync(resolve('examples/initial-conversation.json'), 'utf8')) as IngestInput;
export const events = [1, 2, 3, 4, 5].map(i => JSON.parse(readFileSync(resolve(`examples/event-${i}.json`), 'utf8')) as EventInput);
export const catalog: CatalogEntry[] = [
  { sku: 'ALFBTC-013-320100', description: 'Lona Frontlit BTE 13 3.20x100' },
  { sku: 'ALMCLC-0909-320100', description: 'Lona Mesh CLN 9x9 3.20x100' },
  { sku: 'AVMICS-1A-137050', description: 'Vinil Adhesivo Microperforado 1.37x50' },
  { sku: 'ARACBL-03-122244', description: 'Acrilico Blanco 3mm 1.22x2.44' },
];
export const context = { catalogSkus: catalog.map(p => p.sku), messageCount: 4 };
