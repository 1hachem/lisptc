import type { ProviderName } from "@repo/ai";

export const CHAT_PROVIDER: ProviderName = "openrouter";
export const CHAT_MODEL = "google/gemma-4-31b-it:free";

// Providers with a local KV cache to prime. A hosted provider has no slot to
// warm, and leaving the status at "pending" would lock the app's composer.
const WARMUP_PROVIDERS = new Set<ProviderName>(["llamacpp"]);

export const NEEDS_WARMUP = WARMUP_PROVIDERS.has(CHAT_PROVIDER);
