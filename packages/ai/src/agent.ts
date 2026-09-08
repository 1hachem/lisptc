import { toLangchain } from "@repo/llm/client";
import type { ChatMessage } from "@repo/shared/messages";
import { getProvider, type ProviderName } from "./provider.ts";
import { type TraceContext, traceCallbacks } from "./telemetry.ts";

export const DEFAULT_SYSTEM_PROMPT =
	"You are the reasoning core of a neuro-symbolic agent. Think step by step and answer clearly and concisely.";

export type { Role } from "@repo/shared/messages";

export type AgentMessage = ChatMessage;

export interface TokenUsage {
	input: number;
	output: number;
	cachedInput?: number;
}

export interface AgentDelta {
	text?: string;
	reasoning?: string;
	usage?: TokenUsage;
}

export interface AgentConfig {
	provider?: ProviderName;
	model?: string;
	system?: string;
	trace?: TraceContext;
}

function chunkReasoning(chunk: { additional_kwargs?: unknown }): string {
	const kwargs = chunk.additional_kwargs as
		| { reasoning_content?: unknown }
		| undefined;
	const reasoning = kwargs?.reasoning_content;
	return typeof reasoning === "string" ? reasoning : "";
}

function chunkUsage(chunk: {
	usage_metadata?: unknown;
}): TokenUsage | undefined {
	const usage = chunk.usage_metadata as
		| {
				input_tokens?: unknown;
				output_tokens?: unknown;
				input_token_details?: { cache_read?: unknown };
		  }
		| undefined;
	if (!usage) return undefined;
	const input = typeof usage.input_tokens === "number" ? usage.input_tokens : 0;
	const output =
		typeof usage.output_tokens === "number" ? usage.output_tokens : 0;
	if (input === 0 && output === 0) return undefined;
	const cacheRead = usage.input_token_details?.cache_read;
	return {
		input,
		output,
		...(typeof cacheRead === "number" ? { cachedInput: cacheRead } : {}),
	};
}

export class Agent {
	constructor(private readonly config: AgentConfig = {}) {}

	async *stream(
		messages: AgentMessage[],
		options?: { signal?: AbortSignal },
	): AsyncGenerator<AgentDelta> {
		const model = getProvider(this.config.provider)({
			model: this.config.model,
			streaming: true,
		});
		const history = [
			{
				role: "system" as const,
				content: this.config.system ?? DEFAULT_SYSTEM_PROMPT,
			},
			...messages,
		].map(toLangchain);
		const callbacks = this.config.trace
			? traceCallbacks(this.config.trace)
			: [];
		for await (const chunk of await model.stream(history, {
			signal: options?.signal,
			callbacks,
		})) {
			const reasoning = chunkReasoning(chunk);
			if (reasoning) yield { reasoning };
			const text = chunk.text;
			if (text) yield { text };
			const usage = chunkUsage(chunk);
			if (usage) yield { usage };
		}
	}
}

export function streamAgent(
	messages: AgentMessage[],
	config?: AgentConfig,
	options?: { signal?: AbortSignal },
): AsyncGenerator<AgentDelta> {
	return new Agent(config).stream(messages, options);
}
