import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const serverEnv = createEnv({
	server: {
		PORT: z.coerce.number().int().positive().default(3001),
	},
	runtimeEnv: process.env,
	emptyStringAsUndefined: true,
});
