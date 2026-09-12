import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const replEnv = createEnv({
	server: {
		LISP_DEBUG: z.string().optional(),
		LISPTC_SESSION: z.string().optional(),
		LISPTC_SECRETS_FILE: z.string().optional(),
		XDG_RUNTIME_DIR: z.string().optional(),
		INIT_CWD: z.string().optional(),
	},
	runtimeEnv: process.env,
	emptyStringAsUndefined: true,
});
