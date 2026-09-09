import type { ProviderName } from "@repo/ai";
import { providerSpecs } from "@repo/shared/providers";

export const CHAT_PROVIDER: ProviderName = "aigrid";
export const CHAT_MODEL = providerSpecs[CHAT_PROVIDER].defaultModel;

const WARMUP_PROVIDERS = new Set<ProviderName>(["llamacpp"]);

export const NEEDS_WARMUP = WARMUP_PROVIDERS.has(CHAT_PROVIDER);
