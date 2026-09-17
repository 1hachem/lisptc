import betterAuth from "@convex-dev/better-auth/convex.config";
import migrations from "@convex-dev/migrations/convex.config";
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
	},
});

app.use(betterAuth);
app.use(migrations);

export default app;
