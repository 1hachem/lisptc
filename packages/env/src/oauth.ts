import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

// OAuth / token-store configuration for remote MCP servers. All optional — the
// consumers fall back to loopback + XDG defaults. See devdocs/oauth.md.
export const oauthEnv = createEnv({
	server: {
		// Public callback URL (e.g. a Kubernetes ingress). Set => cloud mode.
		LISPTC_OAUTH_REDIRECT_URL: z.string().optional(),
		// Loopback callback port (must match the registered redirect).
		LISPTC_OAUTH_CALLBACK_PORT: z.coerce.number().int().positive().optional(),
		// Token store directory override.
		LISPTC_OAUTH_DIR: z.string().optional(),
		// XDG base dir used to derive the default token store location.
		XDG_CONFIG_HOME: z.string().optional(),
	},
	runtimeEnv: process.env,
	emptyStringAsUndefined: true,
});
