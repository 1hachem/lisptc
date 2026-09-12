"use client";

import type { TraceEvent } from "@repo/evals/review";
import posthog from "posthog-js";
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
		});
		started = target.key;
	}
	return posthog;
}

export function captureReview(
	target: ReviewTarget,
	review: {
		runId: string;
		trace: TraceEvent[];
		properties: Record<string, unknown>;
	},
): void {
	const ph = client(target);
	if (!traced.has(review.runId)) {
		traced.add(review.runId);
		for (const { event, properties } of review.trace)
			ph.capture(event, properties);
	}
	ph.capture("survey sent", {
		$survey_id: target.surveyId,
		...review.properties,
	});
}
