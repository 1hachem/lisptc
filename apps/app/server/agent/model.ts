import type { ProviderName } from "@repo/ai";
import { DEFAULT_CHOICE } from "@repo/shared/providers";

export function chatModel(chosen?: { provider: ProviderName; model: string }): {
	provider: ProviderName;
	model: string;
} {
	return chosen ?? DEFAULT_CHOICE;
}
