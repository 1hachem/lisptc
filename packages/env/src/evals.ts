import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const evalsEnv = createEnv({
	server: {
		EVAL_REPORT_DIR: z.string().optional(),
		EVAL_STORAGE: z.enum(["r2", "local"]).optional(),
		EVAL_JUDGE: z.string().optional(),
		EVAL_MATRIX: z.string().optional(),
		EVAL_CONCURRENCY: z.coerce.number().int().positive().default(4),
		GITHUB_SHA: z.string().default(""),
	},
	runtimeEnv: process.env,
	emptyStringAsUndefined: true,
});
