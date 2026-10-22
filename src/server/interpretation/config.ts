export type LlmOptions = {
  provider?: "none" | "local" | "groq" | "openai" | "anthropic" | "openai-compatible";
  url?: string;
  model?: string;
  apiKey?: string;
  fetch?: typeof fetch;
};

const endpoints = {
  groq: "https://api.groq.com/openai/v1/chat/completions",
  openai: "https://api.openai.com/v1/chat/completions",
  anthropic: "https://api.anthropic.com/v1/messages",
};

export function resolveLlm(options: LlmOptions) {
  const provider = options.provider ?? (options.url ? "local" : "none");
  if (provider === "none") {
    return undefined;
  }
  if (!["local", "groq", "openai", "anthropic", "openai-compatible"].includes(provider)) {
    throw new Error("Unsupported LLM_PROVIDER.");
  }
  const endpoint = provider in endpoints ? endpoints[provider as keyof typeof endpoints] : options.url;
  if (!endpoint) throw new Error("LLM_URL is required for local or openai-compatible providers.");
  const url = new URL(endpoint);
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash ||
      (provider === "local" ? !local || !['http:', 'https:'].includes(url.protocol) : url.protocol !== "https:")) {
    throw new Error("LLM endpoint must use HTTPS, or localhost HTTP with the local provider, without URL credentials, query or fragment.");
  }
  if (!options.model?.trim()) throw new Error("LLM_MODEL is required when a provider is enabled.");
  if (provider !== "local" && !options.apiKey?.trim()) throw new Error("LLM_API_KEY is required for hosted providers.");
  return { provider, url: url.toString(), model: options.model.trim(), apiKey: options.apiKey?.trim() };
}

export function llmOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): LlmOptions {
  // Explicit new configuration takes precedence; retain existing local setups.
  if (!env.LLM_PROVIDER) return { url: env.LOCAL_LLM_URL, model: env.LOCAL_LLM_MODEL };
  return {
    provider: env.LLM_PROVIDER as LlmOptions["provider"],
    model: env.LLM_MODEL, apiKey: env.LLM_API_KEY, url: env.LLM_URL,
  };
}
