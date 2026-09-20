import type { DecisionsSpec } from "@repo/shared/providers";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";
import { invalid } from "./errors.ts";
import { providerSpecs } from "./providers.ts";

const decisionsEnv = createEnv({
	server: {
		JEV_API_KEY: z.string().optional(),
		JEV_ENDPOINT: z.url().default("https://openrouter.ai/api/alpha/decisions"),
		JEV_MODEL: z.string().default("~typesafe/jev-latest"),
		JEV_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
	},
	runtimeEnv: process.env,
	emptyStringAsUndefined: true,
	onValidationError: invalid("decisions"),
});

export const jevSpec: DecisionsSpec = {
	label: "TypeSafe Jev",
	apiKeyEnv: ["JEV_API_KEY", "OPENROUTER_API_KEY"],
	apiKey: decisionsEnv.JEV_API_KEY ?? providerSpecs.openrouter.apiKey,
	endpoint: decisionsEnv.JEV_ENDPOINT,
	model: decisionsEnv.JEV_MODEL,
	timeoutMs: decisionsEnv.JEV_TIMEOUT_MS,
};

export const jevConfigured: boolean = jevSpec.apiKey !== undefined;
