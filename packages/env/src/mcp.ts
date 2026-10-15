import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const mcpEnv = createEnv({
	server: {
		LISPTC_MCP_HOST: z.enum(["kubernetes", "docker", "process"]).optional(),
		KUBERNETES_SERVICE_HOST: z.string().optional(),
		LISPTC_MCP_NAMESPACE: z.string().optional(),
		LISPTC_MCP_IMAGE_TAG: z.string().optional(),
		XDG_DATA_HOME: z.string().optional(),
	},
	runtimeEnv: process.env,
	emptyStringAsUndefined: true,
});
