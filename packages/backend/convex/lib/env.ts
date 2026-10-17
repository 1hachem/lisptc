import { v } from "convex/values";

export const deploymentEnv = {
	SITE_URL: v.string(),
	BETTER_AUTH_SECRET: v.string(),
	GITHUB_CLIENT_ID: v.optional(v.string()),
	GITHUB_CLIENT_SECRET: v.optional(v.string()),
	GOOGLE_CLIENT_ID: v.optional(v.string()),
	GOOGLE_CLIENT_SECRET: v.optional(v.string()),
	POSTHOG_API_KEY: v.string(),
	POSTHOG_HOST: v.optional(v.string()),
};
