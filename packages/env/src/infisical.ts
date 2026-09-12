import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";
import { invalid } from "./errors.ts";

export const infisicalEnv = createEnv({
	server: {
		INFISICAL_CLIENT_ID: z.string().min(1),
		INFISICAL_CLIENT_SECRET: z.string().min(1),
	},
	runtimeEnv: process.env,
	emptyStringAsUndefined: true,
	onValidationError: invalid("Infisical"),
});
