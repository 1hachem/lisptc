import { convexAdminEnv } from "@repo/env/convex-admin";
import { backendServiceName, syncPostHogLogStream } from "../src/log-stream.ts";

const token = convexAdminEnv.POSTHOG_API_KEY;
if (token) {
	const serviceName = backendServiceName(convexAdminEnv.VITE_ENVIRONMENT);
	const outcome = await syncPostHogLogStream({
		deploymentUrl: convexAdminEnv.CONVEX_SELF_HOSTED_URL,
		adminKey: convexAdminEnv.CONVEX_SELF_HOSTED_ADMIN_KEY,
		projectToken: token,
		host: convexAdminEnv.POSTHOG_HOST ?? "https://us.i.posthog.com",
		serviceName,
	});
	console.log(`[log-stream] posthog log stream ${outcome} as ${serviceName}`);
} else {
	console.log("[log-stream] POSTHOG_API_KEY unset, convex logs stay local");
}
