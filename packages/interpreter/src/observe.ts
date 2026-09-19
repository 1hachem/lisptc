import { slot } from "@repo/interpreter/session";
import type { ChatMessage } from "@repo/shared/messages";

export interface LlmCall {
	builtin: string;
	provider?: string;
	model?: string;
	messages: ChatMessage[];
	structured: boolean;
	latencyMs: number;
	output?: string;
	inputTokens?: number;
	outputTokens?: number;
	error?: string;
}

export type LlmObserver = (call: LlmCall) => void;

export interface Observed {
	observe?: LlmObserver;
}

export const llmSlot = slot<Observed>("llm");
