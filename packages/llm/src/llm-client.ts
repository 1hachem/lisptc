import type { CallbackHandlerMethods } from "@langchain/core/callbacks/base";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { LLMResult } from "@langchain/core/outputs";
import { defaultProvider, providerSpecs } from "@repo/env/providers";
import { contentToText } from "@repo/shared/messages";
import {
	PROVIDER_NAMES,
	type ProviderName,
	providerSpecFor,
} from "@repo/shared/providers";
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
	model: BaseChatModel;
	provider: string;
	name: string;
}

async function chatModel(req: LlmRequest): Promise<Target> {
	const provider = req.provider ?? defaultProvider;
	const spec = providerSpecFor(provider, providerSpecs);
	const name = req.model ?? spec.defaultModel;
	const { getChatProvider } = await import("@repo/models/providers");
	const model = getChatProvider(provider as ProviderName)({
		model: name,
		temperature: req.temperature,
		maxTokens: req.maxTokens,
		streaming: false,
		reasoningEffort: req.reasoningEffort ?? null,
		repeatPenalty: null,
		variant: null,
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
