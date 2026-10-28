import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const desktopEnv = createEnv({
	server: {
		LISPTC_DESKTOP_URL: z.url().default("https://lisptc.taild4910a.ts.net/"),
		LISPTC_DESKTOP_FALLBACK_URL: z
			.url()
			.default("https://lisptc.taild4910a.ts.net/"),
		APPIMAGE: z.string().optional(),
		XDG_CONFIG_HOME: z.string().optional(),
	},
	runtimeEnv: process.env,
	emptyStringAsUndefined: true,
});
