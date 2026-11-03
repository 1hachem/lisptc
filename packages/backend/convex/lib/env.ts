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
	POSTHOG_ENVIRONMENT: v.optional(v.string()),
	POSTHOG_PRIVACY_MODE: v.optional(v.string()),
	LLM_PROVIDER: v.optional(v.string()),
	DO_API_KEY: v.optional(v.string()),
	DO_BASE_URL: v.optional(v.string()),
	DO_MODEL: v.optional(v.string()),
	OPENROUTER_API_KEY: v.optional(v.string()),
	OPENROUTER_BASE_URL: v.optional(v.string()),
	OPENROUTER_MODEL: v.optional(v.string()),
};
