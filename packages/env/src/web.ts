import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

const bundled = (import.meta as unknown as { env: Record<string, string> }).env;

export const webEnv = createEnv({
	server: {
		CONVEX_URL: z.url(),
		CONVEX_SITE_URL: z.url(),
	},
	clientPrefix: "VITE_",
	client: {
		VITE_CONVEX_URL: z.url(),
		VITE_ENVIRONMENT: z.enum(["dev", "staging", "prod"]),
		VITE_POSTHOG_KEY: z.string(),
		VITE_POSTHOG_SURVEY_ID: z.string(),
	},
	runtimeEnv:
		typeof process === "undefined" ? bundled : { ...process.env, ...bundled },
	isServer: typeof window === "undefined",
	emptyStringAsUndefined: true,
});
