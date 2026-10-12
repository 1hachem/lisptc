import betterAuth from "@convex-dev/better-auth/convex.config";
import migrations from "@convex-dev/migrations/convex.config";
import posthog from "@posthog/convex/convex.config";
import { defineApp } from "convex/server";
import { v } from "convex/values";

const app = defineApp({
	env: {
		SITE_URL: v.string(),
		BETTER_AUTH_SECRET: v.string(),
		GITHUB_CLIENT_ID: v.optional(v.string()),
		GITHUB_CLIENT_SECRET: v.optional(v.string()),
		GOOGLE_CLIENT_ID: v.optional(v.string()),
		GOOGLE_CLIENT_SECRET: v.optional(v.string()),
		POSTHOG_API_KEY: v.string(),
		POSTHOG_HOST: v.optional(v.string()),
	},
});

app.use(betterAuth);
app.use(migrations);
app.use(posthog, {
	env: {
		POSTHOG_PROJECT_TOKEN: app.env.POSTHOG_API_KEY,
		POSTHOG_HOST: app.env.POSTHOG_HOST,
	},
});

export default app;
