import { z } from "zod";

export const quoteLineInputSchema = z.object({
  sku: z.string().trim().min(1),
  quantity: z.number().int().positive().max(2147483647),
}).strict();

// Catalog membership is enforced by the database foreign key, not this shape.
// IDs, status, and timestamps are assigned by the application/database.
export const createQuoteInputSchema = z.object({
  customerId: z.string().trim().min(1),
  lines: z.array(quoteLineInputSchema).min(1),
}).strict().superRefine(({ lines }, context) => {
  const seen = new Set<string>();
  for (const [index, line] of lines.entries()) {
    if (seen.has(line.sku)) {
      context.addIssue({
        code: "custom",
        path: ["lines", index, "sku"],
        message: "Each SKU can appear only once per quote.",
      });
    }
    seen.add(line.sku);
  }
});

export type CreateQuoteInput = z.infer<typeof createQuoteInputSchema>;
