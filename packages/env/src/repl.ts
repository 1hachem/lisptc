import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const replEnv = createEnv({
	server: {
		LISP_DEBUG: z.string().optional(),
	},
	runtimeEnv: process.env,
	emptyStringAsUndefined: true,
});
