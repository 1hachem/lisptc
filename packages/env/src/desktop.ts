import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const desktopEnv = createEnv({
	server: {
		LISPTC_DESKTOP_URL: z.url().default("http://localhost:3000"),
	},
	runtimeEnv: process.env,
	emptyStringAsUndefined: true,
});
