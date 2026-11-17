import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const kgEnv = createEnv({
	server: {
		LISPTC_KG_DIR: z.string().optional(),
		XDG_CONFIG_HOME: z.string().optional(),
	},
	runtimeEnv: process.env,
	emptyStringAsUndefined: true,
});
