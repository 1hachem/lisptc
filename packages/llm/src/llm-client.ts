import type { CallbackHandlerMethods } from "@langchain/core/callbacks/base";
import type { LLMResult } from "@langchain/core/outputs";
import type { ChatOpenAI } from "@langchain/openai";
import { contentToText } from "@repo/shared/messages";
import {
	defaultProviderName,
	PROVIDER_NAMES,
	providerSpecFor,
	providerSpecs,
} from "@repo/shared/providers";
import type { Generate, LlmRequest, ProviderReport } from "./llm.ts";

export function listProviders(): ProviderReport[] {
	const first = defaultProviderName();
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
}

function usageCollector(usage: Usage): CallbackHandlerMethods {
	return {
		handleLLMEnd(output: LLMResult) {
			const counts = output.llmOutput?.tokenUsage as
				| { promptTokens?: number; completionTokens?: number }
				| undefined;
			const metadata = output.generations[0]?.[0] as
				| { message?: { usage_metadata?: Record<string, number> } }
				| undefined;
			const meta = metadata?.message?.usage_metadata;
			const input = counts?.promptTokens ?? meta?.input_tokens;
			const completion = counts?.completionTokens ?? meta?.output_tokens;
			if (input !== undefined) usage.inputTokens = input;
			if (completion !== undefined) usage.outputTokens = completion;
		},
	};
}

interface Target {
	model: ChatOpenAI;
	provider: string;
	name: string;
}

async function chatModel(req: LlmRequest): Promise<Target> {
	const provider = req.provider ?? defaultProviderName();
	const spec = providerSpecFor(provider);
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
