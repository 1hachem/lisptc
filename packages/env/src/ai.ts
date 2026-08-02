import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

// AI provider credentials (Fireworks).
export const aiEnv = createEnv({
	server: {
		FIREWORKS_API_KEY: z.string().optional(),
	},
	runtimeEnv: process.env,
	emptyStringAsUndefined: true,
});
