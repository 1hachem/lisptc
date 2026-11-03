import type { AgentConfig } from "@repo/ai";
import { streamDeltas } from "@repo/ai/model-stream";
import { defineProvider, providerShapes } from "@repo/ai/provider/core";
import type { ModelDelta, ModelRequest } from "@repo/interpreter/session";
import {
	DEFAULT_PROVIDER,
	isProviderName,
	type ProviderName,
	type ProviderSpec,
} from "@repo/shared/providers";
import { env } from "../_generated/server.js";

function providerOf(config: AgentConfig): ProviderName {
	if (config.provider !== undefined) return config.provider;
	const named = env.LLM_PROVIDER;
	return named !== undefined && isProviderName(named)
		? named
		: DEFAULT_PROVIDER;
}

function specFor(provider: ProviderName): ProviderSpec {
	if (provider === "digitalocean")
		return {
			label: "DigitalOcean inference",
			apiKeyEnv: "DO_API_KEY",
			apiKey: env.DO_API_KEY,
			baseUrl: env.DO_BASE_URL ?? "https://inference.do-ai.run/v1",
			defaultModel: env.DO_MODEL ?? "glm-5.3-flash",
		};
	return {
		label: "OpenRouter",
		apiKeyEnv: "OPENROUTER_API_KEY",
		apiKey: env.OPENROUTER_API_KEY,
		baseUrl: env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1",
		defaultModel: env.OPENROUTER_MODEL ?? "anthropic/claude-haiku-5.5",
	};
}

export interface Upstream {
	readonly provider: ProviderName;
	readonly model: string;
	readonly baseUrl: string;
}

export function upstreamFor(config: AgentConfig): Upstream {
	const provider = providerOf(config);
	const spec = specFor(provider);
	return {
		provider,
		model: config.model ?? spec.defaultModel,
		baseUrl: spec.baseUrl,
	};
}

export function streamCompletion(
	{ provider, model }: Upstream,
	request: ModelRequest,
	signal: AbortSignal,
): AsyncGenerator<ModelDelta> {
	const chat = defineProvider({
		...specFor(provider),
		...providerShapes[provider],
	})({ model, streaming: true });
	return streamDeltas(chat, request.system, request.messages, { signal });
}
