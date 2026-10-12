import { PostHogProvider } from "@posthog/react";
import { webEnv } from "@repo/env/web";
import posthog, { type PostHogConfig } from "posthog-js";
import { type ReactNode, useEffect } from "react";

const ENVIRONMENT = webEnv.VITE_ENVIRONMENT;
const IS_DEV = ENVIRONMENT === "dev";

const PROXY_PATH = "/ingest";

let markLoaded = () => {};
const loaded = new Promise<void>((resolve) => {
	markLoaded = resolve;
});

const OPTIONS: Partial<PostHogConfig> = {
	loaded: () => markLoaded(),
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
	...(typeof location === "undefined"
		? {}
		: { tracing_headers: [location.hostname] }),
	before_send: (event) => {
		if (event)
			event.properties = { ...event.properties, environment: ENVIRONMENT };
		return event;
	},
};

export function reportIssue(
	error: unknown,
	properties: Record<string, unknown> = {},
): void {
	if (IS_DEV) return;
	posthog.captureException(error, properties);
}

export function captureFeedback(properties: Record<string, unknown>): void {
	posthog.capture("survey sent", {
		$survey_id: webEnv.VITE_POSTHOG_SURVEY_ID,
		...properties,
	});
}

export interface IdentifiedUser {
	_id: string;
	email: string;
	name: string;
}

export function useIdentify(user: IdentifiedUser | undefined): void {
	useEffect(() => {
		if (user === undefined) return;
		void loaded.then(() => {
			if (posthog.get_distinct_id() === user._id) return;
			posthog.identify(user._id, { email: user.email, name: user.name });
		});
	}, [user]);
}

export function forgetUser(): void {
	posthog.reset();
}

export function Analytics({ children }: { children: ReactNode }) {
	return (
		<PostHogProvider apiKey={webEnv.VITE_POSTHOG_KEY} options={OPTIONS}>
			{children}
		</PostHogProvider>
	);
}
