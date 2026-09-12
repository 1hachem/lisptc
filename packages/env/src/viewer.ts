import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const viewerEnv = createEnv({
	clientPrefix: "NEXT_PUBLIC_",
	client: {
		NEXT_PUBLIC_POSTHOG_KEY: z.string().optional(),
		NEXT_PUBLIC_POSTHOG_HOST: z.url().default("https://us.i.posthog.com"),
		NEXT_PUBLIC_POSTHOG_SURVEY_ID: z.string().optional(),
	},
	runtimeEnv: {
		NEXT_PUBLIC_POSTHOG_KEY: process.env.NEXT_PUBLIC_POSTHOG_KEY,
		NEXT_PUBLIC_POSTHOG_HOST: process.env.NEXT_PUBLIC_POSTHOG_HOST,
		NEXT_PUBLIC_POSTHOG_SURVEY_ID: process.env.NEXT_PUBLIC_POSTHOG_SURVEY_ID,
	},
	emptyStringAsUndefined: true,
});
