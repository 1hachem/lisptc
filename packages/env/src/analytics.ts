import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

// PostHog, the sink for agent traces and the notes written about them. Every
// field is optional: with no key the telemetry layer degrades to a no-op, so a
// checkout with no PostHog project still runs the agent.
export const analyticsEnv = createEnv({
	server: {
		POSTHOG_API_KEY: z.string().optional(),
		POSTHOG_HOST: z.string().optional(),
		// Separates local traces from deployed ones in the same project, so a
		// dashboard can filter to either without two projects to keep in sync.
		POSTHOG_ENVIRONMENT: z.string().optional(),
	},
	runtimeEnv: process.env,
	emptyStringAsUndefined: true,
});
