import {
  createInterpretationSchema,
  type Interpretation,
  type InterpretationContext,
} from "./schema";

export type InterpretationDecision =
  | { status: "ready"; interpretation: Interpretation }
  | {
      status: "needs_clarification";
      reason: "unresolved_items" | "no_items";
      interpretation: Interpretation;
    };

// Invalid output throws a ZodError; it must never be treated as a draft.
// This is a pure validation/decision step, with no model calls or persistence.
export function validateInterpretation(
  output: unknown,
  context: InterpretationContext,
): InterpretationDecision {
  const interpretation = createInterpretationSchema(context).parse(output);

  if (interpretation.unresolved.length > 0) {
    return { status: "needs_clarification", reason: "unresolved_items", interpretation };
  }
  if (interpretation.items.length === 0) {
    return { status: "needs_clarification", reason: "no_items", interpretation };
  }
  return { status: "ready", interpretation };
}
