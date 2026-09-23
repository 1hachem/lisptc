import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";
import { invalid } from "./errors.ts";

export const dashiCodesEnv = createEnv({
	server: {
		DASHI_CODES_PREFIX: z.string().default("fallow/"),
		DASHI_CODES_REPO: z.string().optional(),
	},
	runtimeEnv: process.env,
	emptyStringAsUndefined: true,
	onValidationError: invalid("dashi-codes"),
});
