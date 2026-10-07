import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const mcpEnv = createEnv({
	server: {
		LISPTC_MCP_HOST: z.enum(["docker", "kubernetes"]).default("docker"),
		LISPTC_MCP_NAMESPACE_PREFIX: z
			.string()
			.regex(/^[a-z][a-z0-9-]*$/)
			.default("lisptc-ws-"),
		LISPTC_MCP_CALLER_NAMESPACE: z.string().optional(),
		LISPTC_MCP_PULL_SECRET: z.string().optional(),
	},
	runtimeEnv: process.env,
	emptyStringAsUndefined: true,
});
