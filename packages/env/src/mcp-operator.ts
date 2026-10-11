import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const mcpOperatorEnv = createEnv({
	server: {
		LISPTC_MCP_NAMESPACE: z.string().min(1),
		LISPTC_MCP_NAMESPACE_PREFIX: z
			.string()
			.regex(/^[a-z][a-z0-9-]*$/)
			.default("lisptc-ws-"),
		LISPTC_MCP_PULL_SECRET: z.string().optional(),
		LISPTC_MCP_STORAGE_CLASS: z.string().optional(),
		CONVEX_URL: z.url(),
		CONVEX_ADMIN_KEY: z.string().min(1),
	},
	runtimeEnv: process.env,
	emptyStringAsUndefined: true,
});
