import type { CatalogEntry, HistoryMessage } from "../pipeline/contracts";
import type { LlmOptions } from "./config";
import { createJsonClient } from "./client";
import { INTERPRETATION_PROMPT } from "./prompt";
import { validateInterpretation, type InterpretationDecision } from "./validate";
export type Interpreter = (history: readonly HistoryMessage[], catalog: readonly CatalogEntry[]) => Promise<InterpretationDecision>;

export function createInterpreter(options: LlmOptions = {}): Interpreter {
  const generate = createJsonClient(options);
  return async (history, catalog) => {
    const output = await generate(INTERPRETATION_PROMPT, {
      catalog, conversation: history.map((message, index) => ({ index, ...message })),
    });
    return validateInterpretation(output, { catalogSkus: catalog.map(p => p.sku), messageCount: history.length });
  };
}
