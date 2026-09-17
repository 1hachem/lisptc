import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const convexDeployEnv = createEnv({
	server: {
		SITE_URL: z.url(),
		BETTER_AUTH_SECRET: z.string().min(32),
		GITHUB_CLIENT_ID: z.string().optional(),
		GITHUB_CLIENT_SECRET: z.string().optional(),
		GOOGLE_CLIENT_ID: z.string().optional(),
		GOOGLE_CLIENT_SECRET: z.string().optional(),
	},
	runtimeEnv: process.env,
	emptyStringAsUndefined: true,
});
