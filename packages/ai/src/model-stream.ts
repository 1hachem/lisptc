import type { Callbacks } from "@langchain/core/callbacks/manager";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
	AIMessage,
	type BaseMessage,
	HumanMessage,
	SystemMessage,
} from "@langchain/core/messages";
import type { ModelDelta, ModelUsage } from "@repo/interpreter/session";
import type { ChatMessage } from "@repo/shared/messages";

function toLangchain(message: ChatMessage): BaseMessage {
	if (message.role === "system") return new SystemMessage(message.content);
	if (message.role === "assistant") return new AIMessage(message.content);
	return new HumanMessage(message.content);
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
}): ModelUsage | undefined {
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

export async function* streamDeltas(
	model: BaseChatModel,
	system: string,
	messages: readonly ChatMessage[],
	options: { signal?: AbortSignal; callbacks?: Callbacks } = {},
): AsyncGenerator<ModelDelta> {
	const history = [{ role: "system" as const, content: system }, ...messages];
	for await (const chunk of await model.stream(history.map(toLangchain), {
		signal: options.signal,
		callbacks: options.callbacks,
	})) {
		const reasoning = chunkReasoning(chunk);
		if (reasoning) yield { reasoning };
		const text = chunk.text;
		if (text) yield { text };
		const usage = chunkUsage(chunk);
		if (usage) yield { usage };
	}
}
