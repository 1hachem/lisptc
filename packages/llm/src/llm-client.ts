import type { CallbackHandlerMethods } from "@langchain/core/callbacks/base";
import type { LLMResult } from "@langchain/core/outputs";
import type { ChatOpenAI } from "@langchain/openai";
import { defaultProvider, providerSpecs } from "@repo/env/providers";
import { contentToText } from "@repo/shared/messages";
import { PROVIDER_NAMES, providerSpecFor } from "@repo/shared/providers";
import type { Generate, LlmRequest, ProviderReport } from "./llm.ts";

export function listProviders(): ProviderReport[] {
	const first = defaultProvider;
	const order = [first, ...PROVIDER_NAMES.filter((name) => name !== first)];
	return order.map((name) => ({
		name,
		model: providerSpecs[name].defaultModel,
		ready: providerSpecs[name].apiKey !== undefined,
	}));
}

interface Usage {
	inputTokens?: number;
	outputTokens?: number;
	cachedInputTokens?: number;
}

type Counts = Record<string, unknown> | undefined;

function countAt(counts: Counts, key: string): number | undefined {
	const value = counts?.[key];
	return typeof value === "number" ? value : undefined;
}

function nested(counts: Counts, key: string): Counts {
	const value = counts?.[key];
	return typeof value === "object" && value !== null
		? (value as Record<string, unknown>)
		: undefined;
}

function cacheReadTokens(counts: Counts): number | undefined {
	return (
		countAt(nested(counts, "input_token_details"), "cache_read") ??
		countAt(nested(counts, "prompt_tokens_details"), "cached_tokens") ??
		countAt(counts, "cache_read_input_tokens") ??
		countAt(counts, "cached_tokens")
	);
}

function usageCollector(usage: Usage): CallbackHandlerMethods {
	return {
		handleLLMEnd(output: LLMResult) {
			const counts = output.llmOutput?.tokenUsage as Counts;
			const metadata = output.generations[0]?.[0] as
				| { message?: { usage_metadata?: Record<string, unknown> } }
				| undefined;
			const meta = metadata?.message?.usage_metadata;
			const input =
				countAt(counts, "promptTokens") ?? countAt(meta, "input_tokens");
			const completion =
				countAt(counts, "completionTokens") ?? countAt(meta, "output_tokens");
			const cached = cacheReadTokens(meta) ?? cacheReadTokens(counts);
			if (input !== undefined) usage.inputTokens = input;
			if (completion !== undefined) usage.outputTokens = completion;
			if (cached !== undefined) usage.cachedInputTokens = cached;
		},
	};
}

interface Target {
	model: ChatOpenAI;
	provider: string;
	name: string;
}

async function chatModel(req: LlmRequest): Promise<Target> {
	const provider = req.provider ?? defaultProvider;
	const spec = providerSpecFor(provider, providerSpecs);
	if (spec.apiKey === undefined)
		throw new Error(
			`${spec.apiKeyEnv} is not set. Add it to your environment (.env) to talk to ${spec.label}.`,
		);
	const name = req.model ?? spec.defaultModel;
	const { ChatOpenAI } = await import("@langchain/openai");
	const model = new ChatOpenAI({
		apiKey: spec.apiKey,
		model: name,
		temperature: req.temperature,
		maxTokens: req.maxTokens,
		streaming: false,
		configuration: { baseURL: spec.baseUrl },
		modelKwargs: {
			...spec.body,
			...(req.reasoningEffort === undefined
				? {}
				: { reasoning_effort: req.reasoningEffort }),
		},
	});
	return { model, provider, name };
}

export const langchainGenerate: Generate = async (req, signal) => {
	const { model, provider, name } = await chatModel(req);
	const { toLangchain } = await import("./langchain.ts");
	const messages = req.messages.map(toLangchain);
	const usage: Usage = {};
	const options = { signal, callbacks: [usageCollector(usage)] };
	const target = { provider, model: name };
	if (req.schema !== undefined) {
		const structured = model.withStructuredOutput(req.schema.schema, {
			name: req.schema.name,
			method: "jsonSchema",
		});
		const value = await structured.invoke(messages, options);
		return { text: JSON.stringify(value), value, ...target, ...usage };
	}
	const reply = await model.invoke(messages, options);
	return { text: contentToText(reply.content), ...target, ...usage };
};
