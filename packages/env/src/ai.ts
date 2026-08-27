import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

// AI provider credentials (Fireworks) + local llama.cpp server config.
export const aiEnv = createEnv({
	server: {
		FIREWORKS_API_KEY: z.string().optional(),
		FIREWORKS_MODEL: z.string().optional(),
		FIREWORKS_BASE_URL: z.string().optional(),
		LLAMACPP_MODEL: z.string().optional(),
		LLAMACPP_BASE_URL: z.string().optional(),
	},
	runtimeEnv: process.env,
	emptyStringAsUndefined: true,
});
