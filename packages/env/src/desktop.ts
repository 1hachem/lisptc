import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const desktopEnv = createEnv({
	server: {
		LISPTC_DESKTOP_URL: z.url().default("https://lisptc.taild4910a.ts.net/"),
	},
	runtimeEnv: process.env,
	emptyStringAsUndefined: true,
});
