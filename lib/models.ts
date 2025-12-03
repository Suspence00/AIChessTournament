import { ArenaModelOption } from "./types";

export const modelOptions: ArenaModelOption[] = [
  // xAI
  { label: "Grok Code Fast", value: "xai/grok-code-fast-1", provider: "xAI", context: "256K", inputCostPerMTokens: 0.20, outputCostPerMTokens: 1.50, cacheReadCostPerMTokens: 0.02 },

  // Anthropic
  { label: "Claude Sonnet 4.5", value: "anthropic/claude-sonnet-4.5", provider: "Anthropic", context: "200K", inputCostPerMTokens: 3.00, outputCostPerMTokens: 15.00, cacheReadCostPerMTokens: 0.30, cacheWriteCostPerMTokens: 3.75 },
  { label: "Claude Sonnet 4", value: "anthropic/claude-sonnet-4", provider: "Anthropic", context: "200K", inputCostPerMTokens: 3.00, outputCostPerMTokens: 15.00, cacheReadCostPerMTokens: 0.30, cacheWriteCostPerMTokens: 3.75 },
  { label: "Claude 3.7 Sonnet", value: "anthropic/claude-3.7-sonnet", provider: "Anthropic", context: "200K", inputCostPerMTokens: 3.00, outputCostPerMTokens: 15.00, cacheReadCostPerMTokens: 0.30, cacheWriteCostPerMTokens: 3.75 },
  { label: "Claude Opus 4.5", value: "anthropic/claude-opus-4.5", provider: "Anthropic", context: "200K", inputCostPerMTokens: 5.00, outputCostPerMTokens: 25.00, cacheReadCostPerMTokens: 0.50, cacheWriteCostPerMTokens: 6.25 },
  { label: "Claude Haiku 4.5", value: "anthropic/claude-haiku-4.5", provider: "Anthropic", context: "200K", inputCostPerMTokens: 1.00, outputCostPerMTokens: 5.00, cacheReadCostPerMTokens: 0.10, cacheWriteCostPerMTokens: 1.25 },

  // Google
  { label: "Gemini 3 Pro Preview", value: "google/gemini-3-pro-preview", provider: "Google", context: "1M", inputCostPerMTokens: 2.00, outputCostPerMTokens: 12.00, cacheReadCostPerMTokens: 0.20 },
  { label: "Gemini 2.5 Pro", value: "google/gemini-2.5-pro", provider: "Google", context: "1M", inputCostPerMTokens: 1.25, outputCostPerMTokens: 10.00, cacheReadCostPerMTokens: 0.13 },
  { label: "Gemini 2.5 Flash", value: "google/gemini-2.5-flash", provider: "Google", context: "1M", inputCostPerMTokens: 0.30, outputCostPerMTokens: 2.50, cacheReadCostPerMTokens: 0.03 },
  { label: "Gemini 2.5 Flash Lite", value: "google/gemini-2.5-flash-lite", provider: "Google", context: "1M", inputCostPerMTokens: 0.10, outputCostPerMTokens: 0.40, cacheReadCostPerMTokens: 0.01 },

  // OpenAI
  { label: "GPT-5 Codex", value: "openai/gpt-5-codex", provider: "OpenAI", context: "400K", inputCostPerMTokens: 1.25, outputCostPerMTokens: 10.00, cacheReadCostPerMTokens: 0.13 },
  // Removed image-gen models
  { label: "GPT-5 Mini", value: "openai/gpt-5-mini", provider: "OpenAI", context: "400K", inputCostPerMTokens: 0.25, outputCostPerMTokens: 2.00, cacheReadCostPerMTokens: 0.03 },
  { label: "GPT-5 Chat", value: "openai/gpt-5-chat", provider: "OpenAI", context: "128K", inputCostPerMTokens: 1.25, outputCostPerMTokens: 10.00, cacheReadCostPerMTokens: 0.13 },
  { label: "GPT-5.1 Instant", value: "openai/gpt-5.1-instant", provider: "OpenAI", context: "128K", inputCostPerMTokens: 1.25, outputCostPerMTokens: 10.00, cacheReadCostPerMTokens: 0.13 },
  { label: "GPT-5.1 Thinking", value: "openai/gpt-5.1-thinking", provider: "OpenAI", context: "400K", inputCostPerMTokens: 1.25, outputCostPerMTokens: 10.00, cacheReadCostPerMTokens: 0.13 },
  { label: "GPT-4o Mini", value: "openai/gpt-4o-mini", provider: "OpenAI", context: "128K", inputCostPerMTokens: 0.15, outputCostPerMTokens: 0.60, cacheReadCostPerMTokens: 0.07 },
  { label: "GPT-4.1 Mini", value: "openai/gpt-4.1-mini", provider: "OpenAI", context: "1M", inputCostPerMTokens: 0.40, outputCostPerMTokens: 1.60, cacheReadCostPerMTokens: 0.10 },

  // Meta
  { label: "Llama 3.1 8B", value: "meta/llama-3.1-8b", provider: "Meta", context: "128K", inputCostPerMTokens: 0.05, outputCostPerMTokens: 0.08 }
];

// Helper to get models grouped by provider
export function getGroupedModels() {
  const groups: Record<string, ArenaModelOption[]> = {};
  modelOptions.forEach(model => {
    const provider = model.provider || "Other";
    if (!groups[provider]) groups[provider] = [];
    groups[provider].push(model);
  });
  return groups;
}
