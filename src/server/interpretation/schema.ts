import { z } from "zod";
import { quoteLineInputSchema } from "../quotes/schemas";

const sourceMessageIndexesSchema = z.array(z.number().int().nonnegative()).min(1);

export const interpretationSchema = z.object({
  items: z.array(quoteLineInputSchema.extend({
    sourceMessageIndexes: sourceMessageIndexesSchema,
  })),
  unresolved: z.array(z.object({
    description: z.string().trim().min(1),
    reason: z.string().trim().min(1),
    sourceMessageIndexes: sourceMessageIndexesSchema,
  }).strict()),
}).strict();

export type Interpretation = z.infer<typeof interpretationSchema>;

export type InterpretationContext = {
  catalogSkus: readonly string[];
  // Count of the exact, ordered history supplied to the interpreter.
  messageCount: number;
};

export function createInterpretationSchema(context: InterpretationContext) {
  const messageCount = z.number().int().nonnegative().parse(context.messageCount);
  const catalogSkus = new Set(context.catalogSkus);

  return interpretationSchema.superRefine((interpretation, validation) => {
    const seenSkus = new Set<string>();
    interpretation.items.forEach((item, index) => {
      if (!catalogSkus.has(item.sku)) {
        validation.addIssue({
          code: "custom",
          path: ["items", index, "sku"],
          message: "SKU must exist in the supplied catalog.",
        });
      }
      if (seenSkus.has(item.sku)) {
        validation.addIssue({
          code: "custom",
          path: ["items", index, "sku"],
          message: "Each SKU can appear only once per interpretation.",
        });
      }
      seenSkus.add(item.sku);
    });

    for (const section of ["items", "unresolved"] as const) {
      interpretation[section].forEach((entry, index) => {
        const seenIndexes = new Set<number>();
        entry.sourceMessageIndexes.forEach((messageIndex, sourceIndex) => {
          if (messageIndex >= messageCount || seenIndexes.has(messageIndex)) {
            validation.addIssue({
              code: "custom",
              path: [section, index, "sourceMessageIndexes", sourceIndex],
              message: "Source indexes must be distinct positions in the supplied history.",
            });
          }
          seenIndexes.add(messageIndex);
        });
      });
    }
  });
}
