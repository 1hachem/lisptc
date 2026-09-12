import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const viewerEnv = createEnv({
	server: {
		POSTHOG_KEY: z.string().optional(),
		POSTHOG_SURVEY_ID: z.string().optional(),
		POSTHOG_HOST: z.url().default("https://us.i.posthog.com"),
		POSTHOG_ASSET_HOST: z.url().default("https://us-assets.i.posthog.com"),
		POSTHOG_UI_HOST: z.url().default("https://us.posthog.com"),
	},
	runtimeEnv: {
		POSTHOG_KEY:
			process.env.POSTHOG_KEY ??
			process.env.VITE_POSTHOG_KEY ??
			process.env.POSTHOG_API_KEY,
		POSTHOG_SURVEY_ID:
			process.env.POSTHOG_SURVEY_ID ?? process.env.VITE_POSTHOG_SURVEY_ID,
		POSTHOG_HOST: process.env.POSTHOG_HOST,
		POSTHOG_ASSET_HOST: process.env.POSTHOG_ASSET_HOST,
		POSTHOG_UI_HOST: process.env.POSTHOG_UI_HOST,
	},
	emptyStringAsUndefined: true,
});
