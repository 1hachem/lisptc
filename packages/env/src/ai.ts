import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const aiEnv = createEnv({
	server: {
		LLAMACPP_SLOT_DIR: z.string().optional(),
	},
	runtimeEnv: process.env,
	emptyStringAsUndefined: true,
});
