import type { ModelDelta } from "@repo/interpreter/session";
import { getChatProvider } from "@repo/models/providers";
import type { ChatMessage } from "@repo/shared/messages";
import type { ProviderName } from "@repo/shared/providers";

export const DEFAULT_SYSTEM_PROMPT =
	"You are the reasoning core of a neuro-symbolic agent. Think step by step and answer clearly and concisely.";

export interface AgentConfig {
	provider?: ProviderName;
	model?: string;
	system?: string;
	instructions?: string;
}

export class Agent {
	constructor(private readonly config: AgentConfig = {}) {}

	async *stream(
		messages: ChatMessage[],
		options?: { signal?: AbortSignal },
	): AsyncGenerator<ModelDelta> {
		const model = getChatProvider(this.config.provider)({
			model: this.config.model,
		});
		yield* model.stream(
			[
				{
					role: "system",
					content: this.config.system ?? DEFAULT_SYSTEM_PROMPT,
				},
				...messages,
			],
			{ signal: options?.signal },
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
