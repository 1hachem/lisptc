"use client";

import type { Tracer } from "@repo/ai";
import posthog from "posthog-js";
import { posthogTracer } from "@/lib/posthog-tracer.ts";
import type { ReviewTarget } from "@/lib/reviews.ts";
import { PROXY_PATH } from "@/lib/reviews.ts";

let started: string | undefined;
const traced = new Set<string>();

function client(target: ReviewTarget): typeof posthog {
	if (started !== target.key) {
		posthog.init(target.key, {
			api_host: PROXY_PATH,
			ui_host: target.uiHost,
			autocapture: false,
			capture_pageview: false,
			capture_exceptions: false,
			capture_performance: false,
			disable_session_recording: true,
			persistence: "localStorage",
			before_send: (event) => {
				if (event)
					event.properties = {
						...event.properties,
						environment: target.environment,
					};
				return event;
			},
		});
		started = target.key;
	}
	return posthog;
}

export function captureReview(
	target: ReviewTarget,
	review: {
		runId: string;
		trace: (tracer: Tracer) => void;
		properties: Record<string, unknown>;
	},
): void {
	const ph = client(target);
	if (!traced.has(review.runId)) {
		traced.add(review.runId);
		review.trace(posthogTracer(ph));
	}
	ph.capture("survey sent", {
		$survey_id: target.surveyId,
		...review.properties,
	});
}
