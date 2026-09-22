import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const memoryEnv = createEnv({
	server: {
		LISPTC_LEARN_LOG: z
			.enum(["true", "false"])
			.default("true")
			.transform((raw) => raw === "true"),
		LISPTC_MEMORY_DIR: z.string().optional(),
		XDG_CONFIG_HOME: z.string().optional(),
	},
	runtimeEnv: process.env,
	emptyStringAsUndefined: true,
});
