import { z } from "zod";
import { resolveLlm, type LlmOptions } from "./config";

export function createJsonClient(options: LlmOptions = {}) {
  const config = resolveLlm(options);
  return async (prompt: string, input: unknown): Promise<unknown> => {
    if (!config) throw new Error("Configure an LLM provider before processing messages.");
    const content = JSON.stringify(input);
    const anthropic = config.provider === "anthropic";
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (anthropic) {
      headers["x-api-key"] = config.apiKey!;
      headers["anthropic-version"] = "2023-06-01";
    } else if (config.apiKey) headers.authorization = `Bearer ${config.apiKey}`;
    console.info("[llm] request", { provider: config.provider, model: config.model });
    const response = await (options.fetch ?? fetch)(config.url, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(20000), headers,
      body: JSON.stringify(anthropic ? {
        model: config.model, max_tokens: 4096, system: prompt,
        messages: [{ role: "user", content }],
      } : {
        model: config.model,
        messages: [{ role: "system", content: prompt }, { role: "user", content }],
        response_format: { type: "json_object" },
      }),
    });
    console.info("[llm] response", { provider: config.provider, status: response.status, requestId: response.headers.get("x-request-id") });
    if (!response.ok) throw new Error(`Interpreter failed (${response.status}).`);
    const raw = await response.json();
    let output: string;
    if (anthropic) {
      const envelope = z.object({ stop_reason: z.literal("end_turn"), content: z.array(z.object({ type: z.string(), text: z.string().optional() })) }).parse(raw);
      output = envelope.content.filter(block => block.type === "text").map(block => block.text ?? "").join("");
    } else {
      const envelope = z.object({ choices: z.array(z.object({ finish_reason: z.string().nullish(), message: z.object({ content: z.string() }) })).min(1) }).parse(raw);
      const choice = envelope.choices[0];
      if (choice.finish_reason && choice.finish_reason !== "stop") throw new Error("Incomplete model response.");
      output = choice.message.content;
    }
    return JSON.parse(output);
  };
}
