import type { ChatMessage } from "@repo/shared/messages";
import type { ProviderSpec } from "@repo/shared/providers";
import OpenAI from "openai";

const MAX_RETRIES = 6;

type Body = Record<string, unknown>;

interface ClientInit {
	apiKey: string;
	baseURL: string;
	maxRetries: number;
}

export interface ChatClient {
	open: (options: ClientInit) => OpenAI;
	body?: Body;
}

export interface ChatOptions {
	model?: string;
	temperature?: number;
	maxTokens?: number;
	reasoningEffort?: string | null;
	repeatPenalty?: number | null;
	variant?: string | null;
	client?: ChatClient;
}

export interface ChatUsage {
	input: number;
	output: number;
	cachedInput?: number;
}

export interface ChatDelta {
	text?: string;
	reasoning?: string;
	usage?: ChatUsage;
}

export interface ChatSchema {
	name: string;
	schema: Record<string, unknown>;
}

export interface ChatCall {
	signal?: AbortSignal;
	schema?: ChatSchema;
}

export interface ChatReply {
	text: string;
	value?: unknown;
	usage?: ChatUsage;
}

export interface ChatModel {
	model: string;
	stream(messages: ChatMessage[], call?: ChatCall): AsyncGenerator<ChatDelta>;
	complete(messages: ChatMessage[], call?: ChatCall): Promise<ChatReply>;
}

export type ChatProvider = (options?: ChatOptions) => ChatModel;

export interface ChatProviderConfig extends ProviderSpec {
	defaults?: ChatOptions;
	variant?: (model: string, variant: string) => string;
}

function given(options: ChatOptions): ChatOptions {
	return Object.fromEntries(
		Object.entries(options).filter(([, value]) => value !== undefined),
	);
}

function bodyOf(options: ChatOptions): Body {
	return {
		...(options.reasoningEffort == null
			? {}
			: { reasoning_effort: options.reasoningEffort }),
		...(options.repeatPenalty == null
			? {}
			: { repetition_penalty: options.repeatPenalty }),
	};
}

function usageOf(
	usage: OpenAI.CompletionUsage | null | undefined,
): ChatUsage | undefined {
	if (!usage) return undefined;
	const input = usage.prompt_tokens ?? 0;
	const output = usage.completion_tokens ?? 0;
	if (input === 0 && output === 0) return undefined;
	const cachedInput = usage.prompt_tokens_details?.cached_tokens;
	return {
		input,
		output,
		...(typeof cachedInput === "number" ? { cachedInput } : {}),
	};
}

function reasoningOf(delta: object | undefined): string {
	const reasoning = (delta as { reasoning_content?: unknown } | undefined)
		?.reasoning_content;
	return typeof reasoning === "string" ? reasoning : "";
}

function formatOf(schema: ChatSchema | undefined): Body {
	return schema === undefined
		? {}
		: {
				response_format: {
					type: "json_schema",
					json_schema: { name: schema.name, schema: schema.schema },
				},
			};
}

export function suffixVariant(model: string, variant: string): string {
	return model.endsWith(`:${variant}`) ? model : `${model}:${variant}`;
}

export function defineChatProvider(config: ChatProviderConfig): ChatProvider {
	return (options = {}) => {
		if (!config.apiKey)
			throw new Error(
				`${config.apiKeyEnv} is not set. Add it to the environment to talk to ${config.label}.`,
			);
		const merged = { ...config.defaults, ...given(options) };
		const named = merged.model ?? config.defaultModel;
		const model =
			config.variant && merged.variant
				? config.variant(named, merged.variant)
				: named;
		const clientOptions: ClientInit = {
			apiKey: config.apiKey,
			baseURL: config.baseUrl,
			maxRetries: MAX_RETRIES,
		};
		const open = () =>
			merged.client
				? merged.client.open(clientOptions)
				: new OpenAI(clientOptions);
		const request = (messages: ChatMessage[]) => ({
			...config.body,
			...bodyOf(merged),
			...merged.client?.body,
			model,
			messages,
			...(merged.temperature === undefined
				? {}
				: { temperature: merged.temperature }),
			...(merged.maxTokens === undefined
				? {}
				: { max_tokens: merged.maxTokens }),
		});
		return {
			model,
			async *stream(messages, call = {}) {
				const chunks = await open().chat.completions.create(
					{
						...request(messages),
						...formatOf(call.schema),
						stream: true,
						stream_options: { include_usage: true },
					} as OpenAI.ChatCompletionCreateParamsStreaming,
					{ signal: call.signal },
				);
				for await (const chunk of chunks) {
					const delta = chunk.choices[0]?.delta;
					const reasoning = reasoningOf(delta);
					if (reasoning) yield { reasoning };
					const text = delta?.content;
					if (text) yield { text };
					const usage = usageOf(chunk.usage);
					if (usage) yield { usage };
				}
			},
			async complete(messages, call = {}) {
				const reply = await open().chat.completions.create(
					{
						...request(messages),
						...formatOf(call.schema),
						stream: false,
					} as OpenAI.ChatCompletionCreateParamsNonStreaming,
					{ signal: call.signal },
				);
				const text = reply.choices[0]?.message.content ?? "";
				const usage = usageOf(reply.usage);
				return {
					text,
					...(call.schema === undefined ? {} : { value: JSON.parse(text) }),
					...(usage ? { usage } : {}),
				};
			},
		};
	};
}
