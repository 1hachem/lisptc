import { systemOneSpec } from "@repo/env/providers";
import { z } from "zod";
import type {
	SystemOneDecision,
	SystemOneProvider,
	SystemOneRequest,
} from "./system-one.ts";

const decisionSchema = z.object({
	answers: z.record(
		z.string(),
		z.object({ type: z.literal("noul"), noul: z.number().min(0).max(1) }),
	),
	usage: z.object({ cost: z.number() }),
});

export interface OpenRouterSystemOneOptions {
	readonly apiKey?: string;
	readonly url?: string;
	readonly model?: string;
	readonly fetch?: typeof fetch;
}

export function openRouterSystemOne(
	options: OpenRouterSystemOneOptions = {},
): SystemOneProvider {
	const apiKey = options.apiKey ?? systemOneSpec.apiKey;
	const url = options.url ?? systemOneSpec.url;
	const model = options.model ?? systemOneSpec.model;
	const send = options.fetch ?? fetch;
	return {
		async decide<K extends string>(
			request: SystemOneRequest<K>,
		): Promise<SystemOneDecision<K>> {
			if (!apiKey)
				throw new Error(
					`${systemOneSpec.apiKeyEnv} is not set, so System One cannot decide`,
				);
			const response = await send(url, {
				method: "POST",
				headers: {
					authorization: `Bearer ${apiKey}`,
					"content-type": "application/json",
				},
				body: JSON.stringify({
					model,
					state: request.state,
					questions: request.questions,
				}),
				signal: request.signal,
			});
			if (!response.ok)
				throw new Error(
					`System One answered ${response.status}: ${await response.text()}`,
				);
			const { answers, usage } = decisionSchema.parse(await response.json());
			const asked = Object.keys(request.questions) as K[];
			const missing = asked.filter((id) => answers[id] === undefined);
			if (missing.length > 0)
				throw new Error(`System One left unanswered: ${missing.join(", ")}`);
			return {
				answers: Object.fromEntries(
					asked.map((id) => [id, { noul: answers[id]?.noul ?? 0 }]),
				) as Record<K, { noul: number }>,
				cost: usage.cost,
			};
		},
	};
}
