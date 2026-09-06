import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const apiEnv = createEnv({
	server: {
		APP_URL: z.url(),
	},
	runtimeEnv: process.env,
	emptyStringAsUndefined: true,
});
