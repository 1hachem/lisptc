import type { ProviderSpec } from "@repo/shared/providers";
import type { SystemOneModel, Verdict } from "@repo/shared/system-one";
import {
	type EntryType,
	type Fetch,
	type Questions,
	TypeSafeClient,
} from "@typesafe-ai/sdk";

export const JEV_MODEL = "typesafe/jev-1.14";

export interface OpenRouterSystemOneConfig
	extends Pick<ProviderSpec, "apiKey" | "apiKeyEnv" | "baseUrl"> {
	fetch?: Fetch;
}

function sdkRoot(baseUrl: string): string {
	return baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
}

export function openRouterSystemOne(
	config: OpenRouterSystemOneConfig,
): SystemOneModel {
	let client: TypeSafeClient | undefined;
	const connect = (): TypeSafeClient => {
		if (config.apiKey === undefined)
			throw new Error(
				`${config.apiKeyEnv} is not set. Add it to the environment to reach ${JEV_MODEL} through OpenRouter.`,
			);
		client ??= new TypeSafeClient({
			apiKey: config.apiKey,
			baseURL: sdkRoot(config.baseUrl),
			defaultModel: JEV_MODEL,
			logLevel: "off",
			...(config.fetch === undefined ? {} : { fetch: config.fetch }),
		});
		return client;
	};
	return {
		provider: "openrouter",
		model: JEV_MODEL,
		async judge(req, signal) {
			const res = await connect().systemOne(
				{
					state: req.state as NonNullable<EntryType>,
					questions: req.questions as Questions,
					...(req.model === undefined ? {} : { model: req.model }),
				},
				{ signal },
			);
			const answers: Record<string, Verdict> = {};
			for (const [id, answer] of Object.entries(res.answers)) {
				if (answer.type === "noul")
					answers[id] = { type: "noul", noul: answer.noul };
				else if (answer.type === "choice")
					answers[id] = {
						type: "choice",
						choice: answer.choice,
						confidence: answer.confidence,
						probabilities: { ...answer.probabilities },
					};
				else if (answer.type === "score")
					answers[id] = {
						type: "score",
						score: answer.score,
						confidence: answer.confidence,
					};
			}
			return { answers, model: res.model };
		},
	};
}
