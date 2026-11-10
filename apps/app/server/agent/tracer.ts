import { tracing } from "@repo/ai";
import { analyticsEnv } from "@repo/env/analytics";
import { posthogTracer } from "./posthog.ts";

export const tracer = tracing([posthogTracer()], {
	privacy: analyticsEnv.TRACE_PRIVACY_MODE,
});
