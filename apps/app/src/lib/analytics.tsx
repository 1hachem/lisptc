import { PostHogProvider } from "@posthog/react";
import { webEnv } from "@repo/env/web";
import posthog, { type PostHogConfig } from "posthog-js";
import type { ReactNode } from "react";
import { API_URL, distinctId } from "./api.ts";

const ENVIRONMENT = webEnv.VITE_ENVIRONMENT;
const IS_DEV = ENVIRONMENT === "dev";

const PROXY_PATH = "/ingest";

const OPTIONS: Partial<PostHogConfig> = {
	api_host: PROXY_PATH,
	ui_host: "https://us.posthog.com",
	defaults: "2026-05-30",
	...(IS_DEV
		? {
				autocapture: false,
				capture_pageview: false,
				capture_exceptions: false,
				capture_performance: false,
				disable_session_recording: true,
			}
		: { capture_exceptions: true }),
	tracing_headers: [new URL(API_URL).hostname],
	bootstrap: { distinctID: distinctId() },
	before_send: (event) => {
		if (event)
			event.properties = { ...event.properties, environment: ENVIRONMENT };
		return event;
	},
};

export function captureFeedback(properties: Record<string, unknown>): void {
	posthog.capture("survey sent", {
		$survey_id: webEnv.VITE_POSTHOG_SURVEY_ID,
		...properties,
	});
}

export function Analytics({ children }: { children: ReactNode }) {
	return (
		<PostHogProvider apiKey={webEnv.VITE_POSTHOG_KEY} options={OPTIONS}>
			{children}
		</PostHogProvider>
	);
}
