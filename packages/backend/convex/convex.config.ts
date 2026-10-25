import betterAuth from "@convex-dev/better-auth/convex.config";
import migrations from "@convex-dev/migrations/convex.config";
import posthog from "@posthog/convex/convex.config";
import { defineApp } from "convex/server";
import { deploymentEnv } from "./lib/env.js";

const app = defineApp({ env: deploymentEnv });

app.use(betterAuth);
app.use(migrations);
app.use(posthog, {
	env: {
		POSTHOG_PROJECT_TOKEN: app.env.POSTHOG_API_KEY,
		POSTHOG_HOST: app.env.POSTHOG_HOST,
	},
});

export default app;
