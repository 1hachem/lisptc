import type { ProviderName } from "@repo/ai";

export const CHAT_PROVIDER: ProviderName = "digitalocean";
export const CHAT_MODEL = "gemma-4-31B-it";

const WARMUP_PROVIDERS = new Set<ProviderName>(["llamacpp"]);

export const NEEDS_WARMUP = WARMUP_PROVIDERS.has(CHAT_PROVIDER);
