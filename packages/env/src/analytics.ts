import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const analyticsEnv = createEnv({
	server: {
		POSTHOG_API_KEY: z.string().optional(),
		POSTHOG_HOST: z.string().optional(),
		POSTHOG_ASSET_HOST: z.string().optional(),
		POSTHOG_ENVIRONMENT: z.string().optional(),
		OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: z.url().optional(),
		TRACE_PRIVACY_MODE: z.stringbool().default(false),
	},
	runtimeEnv: process.env,
	emptyStringAsUndefined: true,
});
