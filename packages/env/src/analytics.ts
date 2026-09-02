import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

// PostHog, the sink for agent traces and the notes written about them. Every
// field is optional: with no key the telemetry layer degrades to a no-op, so a
// checkout with no PostHog project still runs the agent.
//
// The hosts here are also the upstream of the browser's first-party proxy
// (`apps/app/server/routes/ingest/[...path].ts`), so the region is configured
// once for both halves. The browser's own half of the setup — its project key
// and environment — is build-time input to a bundle rather than process
// environment, and lives in `./web.ts`. See devdocs/telemetry.md.
export const analyticsEnv = createEnv({
	server: {
		POSTHOG_API_KEY: z.string().optional(),
		POSTHOG_HOST: z.string().optional(),
		// Where the browser proxy forwards `/static/*`. PostHog serves the
		// lazily loaded bundles from a CDN host, not from the host that accepts
		// events, so a proxy needs both.
		POSTHOG_ASSET_HOST: z.string().optional(),
		// Separates local traces from deployed ones in the same project, so a
		// dashboard can filter to either without two projects to keep in sync.
		POSTHOG_ENVIRONMENT: z.string().optional(),
	},
	runtimeEnv: process.env,
	emptyStringAsUndefined: true,
});
