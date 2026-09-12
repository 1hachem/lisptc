"use client";

import { viewerEnv } from "@repo/env/viewer";
import posthog from "posthog-js";

const KEY = viewerEnv.NEXT_PUBLIC_POSTHOG_KEY;
const SURVEY = viewerEnv.NEXT_PUBLIC_POSTHOG_SURVEY_ID;

export const reviewsEnabled = Boolean(KEY && SURVEY);

let started = false;

function client(): typeof posthog | undefined {
	if (!KEY) return undefined;
	if (!started) {
		posthog.init(KEY, {
			api_host: viewerEnv.NEXT_PUBLIC_POSTHOG_HOST,
			ui_host: "https://us.posthog.com",
			autocapture: false,
			capture_pageview: false,
			capture_exceptions: false,
			capture_performance: false,
			disable_session_recording: true,
			persistence: "localStorage",
		});
		started = true;
	}
	return posthog;
}

export function captureReview(properties: Record<string, unknown>): void {
	if (!reviewsEnabled) return;
	client()?.capture("survey sent", { $survey_id: SURVEY, ...properties });
}
