import type { ModelDelta } from "@repo/interpreter/session";
import type { ChatMessage } from "@repo/shared/messages";
import type { ProviderName } from "@repo/shared/providers";
import { streamDeltas } from "./model-stream.ts";
import { getProvider } from "./provider/registry.ts";
import { type TraceContext, traceCallbacks } from "./telemetry.ts";

export const DEFAULT_SYSTEM_PROMPT =
	"You are the reasoning core of a neuro-symbolic agent. Think step by step and answer clearly and concisely.";

export interface AgentConfig {
	provider?: ProviderName;
	model?: string;
	system?: string;
	instructions?: string;
	trace?: TraceContext;
}

export class Agent {
	constructor(private readonly config: AgentConfig = {}) {}

	async *stream(
		messages: ChatMessage[],
		options?: { signal?: AbortSignal },
	): AsyncGenerator<ModelDelta> {
		const model = getProvider(this.config.provider)({
			model: this.config.model,
			streaming: true,
		});
		yield* streamDeltas(
			model,
			this.config.system ?? DEFAULT_SYSTEM_PROMPT,
			messages,
			{
				signal: options?.signal,
				callbacks: this.config.trace ? traceCallbacks(this.config.trace) : [],
			},
		);
	}
}

export function streamAgent(
	messages: ChatMessage[],
	config?: AgentConfig,
	options?: { signal?: AbortSignal },
): AsyncGenerator<ModelDelta> {
	return new Agent(config).stream(messages, options);
}
