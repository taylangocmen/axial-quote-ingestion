import { z } from "zod";
import type { CatalogEntry, HistoryMessage } from "../pipeline/contracts";
import { INTERPRETATION_PROMPT } from "./prompt";
import { interpretWithRules } from "./rules";
import { validateInterpretation, type InterpretationDecision } from "./validate";
export type Interpreter = (history: readonly HistoryMessage[], catalog: readonly CatalogEntry[]) => Promise<InterpretationDecision>;

export function createInterpreter(options: { url?: string; model?: string; fetch?: typeof fetch } = {}): Interpreter {
  if (options.url) {
    const url = new URL(options.url);
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || !['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      throw new Error("The optional model endpoint must be local.");
    }
    if (!options.model) throw new Error("LOCAL_LLM_MODEL is required when LOCAL_LLM_URL is set.");
  }
  return async (history, catalog) => {
    const context = { catalogSkus: catalog.map(p => p.sku), messageCount: history.length };
    const local = validateInterpretation(interpretWithRules(history, catalog), context);
    if (local.status === "ready" || !options.url) return local;
    const response = await (options.fetch ?? fetch)(options.url, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(20000),
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: options.model,
        messages: [
          { role: "system", content: INTERPRETATION_PROMPT },
          { role: "user", content: JSON.stringify({ catalog, conversation: history.map((m, index) => ({ index, ...m })) }) },
        ],
        response_format: { type: "json_object" },
        temperature: 0,
      }),
    });
    if (!response.ok) throw new Error(`Local interpreter failed (${response.status}).`);
    const envelope = z.object({ choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1) }).parse(await response.json());
    return validateInterpretation(JSON.parse(envelope.choices[0].message.content), context);
  };
}
