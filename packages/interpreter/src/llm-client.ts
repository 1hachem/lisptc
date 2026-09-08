import type { CallbackHandlerMethods } from "@langchain/core/callbacks/base";
import {
	AIMessage,
	type BaseMessage,
	HumanMessage,
	SystemMessage,
} from "@langchain/core/messages";
import type { LLMResult } from "@langchain/core/outputs";
import { ChatOpenAI } from "@langchain/openai";
import {
	aiEnv,
	DEFAULT_PROVIDER,
	type ProviderName,
	providerNames,
	providerSpecs,
} from "@repo/env/ai";
import type {
	Generate,
	LlmMessage,
	LlmRequest,
	ProviderReport,
} from "./llm.ts";

function isProviderName(name: string): name is ProviderName {
	return (providerNames as string[]).includes(name);
}

function defaultProviderName(): ProviderName {
	const configured = aiEnv.LLM_PROVIDER;
	if (configured === undefined) return DEFAULT_PROVIDER;
	if (!isProviderName(configured))
		throw new Error(
			`LLM_PROVIDER is "${configured}", but expected one of ${providerNames.join(", ")}`,
		);
	return configured;
}

function specFor(name: string) {
	if (!isProviderName(name))
		throw new Error(
			`unknown provider "${name}", expected one of ${providerNames.join(", ")}`,
		);
	return providerSpecs[name];
}

export function listProviders(): ProviderReport[] {
	const first = defaultProviderName();
	const order = [first, ...providerNames.filter((name) => name !== first)];
	return order.map((name) => ({
		name,
		model: providerSpecs[name].defaultModel,
		ready: providerSpecs[name].apiKey !== undefined,
	}));
}

function toLangchain(message: LlmMessage): BaseMessage {
	if (message.role === "system") return new SystemMessage(message.content);
	if (message.role === "assistant") return new AIMessage(message.content);
	return new HumanMessage(message.content);
}

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return String(content ?? "");
	return content
		.map((part) =>
			typeof part === "string"
				? part
				: ((part as { text?: string }).text ?? ""),
		)
		.join("");
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

function chatModel(req: LlmRequest): Target {
	const provider = req.provider ?? defaultProviderName();
	const spec = specFor(provider);
	if (spec.apiKey === undefined)
		throw new Error(
			`${spec.apiKeyEnv} is not set. Add it to your environment (.env) to talk to ${spec.label}.`,
		);
	const name = req.model ?? spec.defaultModel;
	const model = new ChatOpenAI({
		apiKey: spec.apiKey,
		model: name,
		temperature: req.temperature,
		maxTokens: req.maxTokens,
		streaming: false,
		configuration: { baseURL: spec.baseUrl },
		modelKwargs:
			req.reasoningEffort === undefined
				? {}
				: { reasoning_effort: req.reasoningEffort },
	});
	return { model, provider, name };
}

export const langchainGenerate: Generate = async (req, signal) => {
	const { model, provider, name } = chatModel(req);
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
	return { text: textOf(reply.content), ...target, ...usage };
};
