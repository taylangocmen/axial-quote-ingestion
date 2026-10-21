import { z } from "zod";

export const catalogItemSchema = z.object({
  sku: z.string().min(1),
  description: z.string().min(1),
});

export const catalog = z.array(catalogItemSchema).parse([
  { sku: "ALFBTC-013-320100", description: "Lona Frontlit BTE 13 3.20x100" },
  { sku: "ALMCLC-0909-320100", description: "Lona Mesh CLN 9x9 3.20x100" },
  { sku: "AVMICS-1A-137050", description: "Vinil Adhesivo Microperforado 1.37x50" },
  { sku: "ARACBL-03-122244", description: "Acrilico Blanco 3mm 1.22x2.44" },
]);
