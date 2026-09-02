import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const webEnv = createEnv({
	clientPrefix: "VITE_",
	client: {
		VITE_API_URL: z.string(),
		VITE_ENVIRONMENT: z.enum(["dev", "staging", "prod"]),
		VITE_POSTHOG_KEY: z.string(),
		VITE_POSTHOG_SURVEY_ID: z.string(),
	},
	runtimeEnv: (import.meta as unknown as { env: Record<string, string> }).env,
	emptyStringAsUndefined: true,
});
