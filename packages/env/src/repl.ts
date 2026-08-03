import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

// REPL configuration. Note: the per-key `REPL_*` secret registry is a dynamic
// prefix scan of process.env (arbitrary names), so it stays outside this schema.
export const replEnv = createEnv({
	server: {
		// `.env` file the standalone CLI seeds secrets from.
		LISPTC_SECRETS_FILE: z.string().optional(),
		// Truthy => extra debug logging in the pi extension.
		LISP_DEBUG: z.string().optional(),
	},
	runtimeEnv: process.env,
	emptyStringAsUndefined: true,
});
