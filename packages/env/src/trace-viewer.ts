import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const traceViewerEnv = createEnv({
	clientPrefix: "NEXT_PUBLIC_",
	client: {
		NEXT_PUBLIC_POSTHOG_KEY: z.string().optional(),
		NEXT_PUBLIC_POSTHOG_SURVEY_ID: z.string().optional(),
		NEXT_PUBLIC_ENVIRONMENT: z.enum(["dev", "staging", "prod"]).default("dev"),
	},
	server: {
		POSTHOG_HOST: z.url().default("https://us.i.posthog.com"),
		POSTHOG_ASSET_HOST: z.url().default("https://us-assets.i.posthog.com"),
		POSTHOG_UI_HOST: z.url().default("https://us.posthog.com"),
	},
	runtimeEnv: {
		NEXT_PUBLIC_POSTHOG_KEY: process.env.NEXT_PUBLIC_POSTHOG_KEY,
		NEXT_PUBLIC_POSTHOG_SURVEY_ID: process.env.NEXT_PUBLIC_POSTHOG_SURVEY_ID,
		NEXT_PUBLIC_ENVIRONMENT: process.env.NEXT_PUBLIC_ENVIRONMENT,
		POSTHOG_HOST: process.env.POSTHOG_HOST,
		POSTHOG_ASSET_HOST: process.env.POSTHOG_ASSET_HOST,
		POSTHOG_UI_HOST: process.env.POSTHOG_UI_HOST,
	},
	emptyStringAsUndefined: true,
});
