import { convexAdminEnv } from "@repo/env/convex-admin";
import { serviceName } from "@repo/env/environments";
import { syncPostHogLogStream } from "../src/log-stream.ts";

const token = convexAdminEnv.POSTHOG_API_KEY;
if (token) {
	const service = serviceName(
		"backend",
		convexAdminEnv.POSTHOG_ENVIRONMENT ?? convexAdminEnv.VITE_ENVIRONMENT,
	);
	const outcome = await syncPostHogLogStream({
		deploymentUrl: convexAdminEnv.CONVEX_SELF_HOSTED_URL,
		adminKey: convexAdminEnv.CONVEX_SELF_HOSTED_ADMIN_KEY,
		projectToken: token,
		host: convexAdminEnv.POSTHOG_HOST ?? "https://us.i.posthog.com",
		serviceName: service,
	});
	console.log(`[log-stream] posthog log stream ${outcome} as ${service}`);
} else {
	console.log("[log-stream] POSTHOG_API_KEY unset, convex logs stay local");
}
