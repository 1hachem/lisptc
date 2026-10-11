import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";
import { analyticsEnv } from "./analytics.ts";
import { ENVIRONMENTS } from "./environments.ts";

export const convexAdminEnv = createEnv({
	server: {
		CONVEX_SELF_HOSTED_URL: z.url(),
		CONVEX_SELF_HOSTED_ADMIN_KEY: z.string().min(1),
		VITE_ENVIRONMENT: z.enum(ENVIRONMENTS),
	},
	extends: [analyticsEnv],
	runtimeEnv: process.env,
	emptyStringAsUndefined: true,
});
