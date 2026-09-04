import {
	AIMessage,
	type BaseMessage,
	HumanMessage,
	SystemMessage,
} from "@langchain/core/messages";
import { getProvider, type ProviderName } from "./provider.ts";
import { type TraceContext, traceCallbacks } from "./telemetry.ts";

export const DEFAULT_SYSTEM_PROMPT =
	"You are the reasoning core of a neuro-symbolic agent. Think step by step and answer clearly and concisely.";

export type Role = "user" | "assistant" | "system";

export interface AgentMessage {
	role: Role;
	content: string;
}

/** Tokens one model call spent, as the provider reported them. */
export interface TokenUsage {
	input: number;
	output: number;
}

/**
 * One streamed step. A chunk carries either visible answer `text` or a
 * `reasoning` token (the model's thinking, surfaced separately so the UI can
 * show it distinctly) — never mixed, so consumers can route each independently.
 *
 * A `usage` delta carries neither: it is the accounting the backend appends
 * once the completion is done, so a consumer that only renders text ignores it.
 */
export interface AgentDelta {
	text?: string;
	reasoning?: string;
	usage?: TokenUsage;
}

export interface AgentConfig {
	provider?: ProviderName;
	/** Model id; the provider falls back to its own default when unset. */
	model?: string;
	system?: string;
	/** When set, each model call is reported to PostHog as an `$ai_generation`. */
	trace?: TraceContext;
}

function toLangChain(m: AgentMessage): BaseMessage {
	switch (m.role) {
		case "assistant":
			return new AIMessage(m.content);
		case "system":
			return new SystemMessage(m.content);
		default:
			return new HumanMessage(m.content);
	}
}

/** Fireworks streams thinking as `additional_kwargs.reasoning_content` (see the provider). */
function chunkReasoning(chunk: { additional_kwargs?: unknown }): string {
	const kwargs = chunk.additional_kwargs as
		| { reasoning_content?: unknown }
		| undefined;
	const reasoning = kwargs?.reasoning_content;
	return typeof reasoning === "string" ? reasoning : "";
}

/**
 * Token counts ride on the final chunk of an OpenAI-style stream — ChatOpenAI
 * asks for them (`stream_options.include_usage`, on by default) and surfaces
 * them as `usage_metadata`. A backend that doesn't report any simply never
 * produces one, and the turn goes uncounted rather than counted wrong.
 */
function chunkUsage(chunk: {
	usage_metadata?: unknown;
}): TokenUsage | undefined {
	const usage = chunk.usage_metadata as
		| { input_tokens?: unknown; output_tokens?: unknown }
		| undefined;
	if (!usage) return undefined;
	const input = typeof usage.input_tokens === "number" ? usage.input_tokens : 0;
	const output =
		typeof usage.output_tokens === "number" ? usage.output_tokens : 0;
	if (input === 0 && output === 0) return undefined;
	return { input, output };
}

/**
 * A single agent turn. Kept as a small class so multiple agents can be composed
 * (routing, hand-offs) later without changing the streaming contract.
 */
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
		const history: BaseMessage[] = [
			new SystemMessage(this.config.system ?? DEFAULT_SYSTEM_PROMPT),
			...messages.map(toLangChain),
		];
		// The callback handler is what turns this call into an `$ai_generation`
		// (tokens, cost, latency); with no trace it is an empty list and LangChain
		// does nothing extra.
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
