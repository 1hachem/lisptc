"use client";

import posthog from "posthog-js";
import type { ReviewTarget } from "@/lib/reviews.ts";

let started: string | undefined;

function client(target: ReviewTarget): typeof posthog {
	if (started !== target.key) {
		posthog.init(target.key, {
			api_host: target.host,
			ui_host: "https://us.posthog.com",
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
	properties: Record<string, unknown>,
): void {
	client(target).capture("survey sent", {
		$survey_id: target.surveyId,
		...properties,
	});
}
