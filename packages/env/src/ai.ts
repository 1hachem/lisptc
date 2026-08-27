import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

// AI provider credentials (Fireworks).
export const aiEnv = createEnv({
	server: {
		FIREWORKS_API_KEY: z.string(),
		FIREWORKS_MODEL: z.string().optional(),
		FIREWORKS_BASE_URL: z.string().optional(),
	},
	runtimeEnv: process.env,
	emptyStringAsUndefined: true,
});
