import { defaultProvider, providerSpecs } from "@repo/env/providers";
import { type ProviderName, providerSpecFor } from "@repo/shared/providers";
import type { Generate } from "./llm.ts";

export const chatGenerate: Generate = async (req, signal) => {
	const provider = req.provider ?? defaultProvider;
	const spec = providerSpecFor(provider, providerSpecs);
	const name = req.model ?? spec.defaultModel;
	const { getChatProvider } = await import("@repo/models/providers");
	const model = getChatProvider(provider as ProviderName)({
		model: name,
		temperature: req.temperature,
		maxTokens: req.maxTokens,
		reasoningEffort: req.reasoningEffort ?? null,
		repeatPenalty: null,
		variant: null,
	});
	const reply = await model.complete(req.messages, {
		signal,
		schema: req.schema,
	});
	return {
		text: reply.value === undefined ? reply.text : JSON.stringify(reply.value),
		...(reply.value === undefined ? {} : { value: reply.value }),
		provider,
		model: name,
		...(reply.usage
			? { inputTokens: reply.usage.input, outputTokens: reply.usage.output }
			: {}),
	};
};
