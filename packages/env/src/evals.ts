import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const evalsEnv = createEnv({
	server: {
		EVAL_REPORT_DIR: z.string().optional(),
		EVAL_JUDGE: z.string().optional(),
		EVAL_MATRIX: z.string().optional(),
		GITHUB_SHA: z.string().default(""),
	},
	runtimeEnv: process.env,
	emptyStringAsUndefined: true,
});
