import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

const raw = createEnv({
	server: {
		APP_URL: z.url().optional(),
		LISPTC_OAUTH_REDIRECT_URL: z.url().optional(),
		LISPTC_OAUTH_CALLBACK_PORT: z.coerce
			.number()
			.int()
			.positive()
			.default(8909),
		LISPTC_OAUTH_DIR: z.string().optional(),
		XDG_CONFIG_HOME: z.string().optional(),
	},
	runtimeEnv: process.env,
	emptyStringAsUndefined: true,
});

function appCallback(appUrl: string | undefined): string | undefined {
	return appUrl === undefined
		? undefined
		: new URL("/oauth/callback", appUrl).href;
}

export const oauthEnv = {
	...raw,
	LISPTC_OAUTH_REDIRECT_URL:
		raw.LISPTC_OAUTH_REDIRECT_URL ??
		appCallback(raw.APP_URL) ??
		`http://127.0.0.1:${raw.LISPTC_OAUTH_CALLBACK_PORT}/callback`,
};
