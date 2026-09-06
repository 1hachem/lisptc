import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const oauthEnv = createEnv({
	server: {
		LISPTC_OAUTH_REDIRECT_URL: z.string().optional(),
		LISPTC_OAUTH_CALLBACK_PORT: z.coerce.number().int().positive().optional(),
		LISPTC_OAUTH_DIR: z.string().optional(),
		XDG_CONFIG_HOME: z.string().optional(),
	},
	runtimeEnv: process.env,
	emptyStringAsUndefined: true,
});
