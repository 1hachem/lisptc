import { webEnv } from "@repo/env/web";
import type { PostHog, PostHogConfig } from "posthog-js/dist/module.slim";
import { type ReactNode, useEffect } from "react";

const ENVIRONMENT = webEnv.VITE_ENVIRONMENT;
const IS_DEV = ENVIRONMENT === "dev";

const PROXY_PATH = "/ingest";

let client: PostHog | undefined;
let started = false;
const waiting: ((posthog: PostHog) => void)[] = [];

const OPTIONS: Partial<PostHogConfig> = {
	api_host: PROXY_PATH,
	ui_host: "https://us.posthog.com",
	defaults: "2026-05-30",
	disable_session_recording: true,
	...(IS_DEV
		? {
				autocapture: false,
				capture_pageview: false,
				capture_exceptions: false,
				capture_performance: false,
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

function withPosthog(use: (posthog: PostHog) => void): void {
	if (client === undefined) waiting.push(use);
	else use(client);
}

async function start(): Promise<void> {
	const { default: posthog } = await import("posthog-js/dist/module.slim");
	posthog.init(webEnv.VITE_POSTHOG_KEY, {
		...OPTIONS,
		loaded: () => {
			client = posthog;
			for (const use of waiting.splice(0)) use(posthog);
		},
	});
}

function whenIdle(run: () => void): void {
	if (typeof requestIdleCallback === "function")
		requestIdleCallback(run, { timeout: 3000 });
	else setTimeout(run, 1);
}

export function distinctId(): string | undefined {
	return client?.get_distinct_id();
}

export function reportIssue(
	error: unknown,
	properties: Record<string, unknown> = {},
): void {
	if (IS_DEV) return;
	withPosthog((posthog) => posthog.captureException(error, properties));
}

export function captureFeedback(properties: Record<string, unknown>): void {
	withPosthog((posthog) =>
		posthog.capture("survey sent", {
			$survey_id: webEnv.VITE_POSTHOG_SURVEY_ID,
			...properties,
		}),
	);
}

export interface IdentifiedUser {
	_id: string;
	email: string;
	name: string;
}

export function useIdentify(user: IdentifiedUser | undefined): void {
	useEffect(() => {
		if (user === undefined) return;
		withPosthog((posthog) => {
			if (posthog.get_distinct_id() === user._id) return;
			posthog.identify(user._id, { email: user.email, name: user.name });
		});
	}, [user]);
}

export function forgetUser(): void {
	withPosthog((posthog) => posthog.reset());
}

export function Analytics({ children }: { children: ReactNode }) {
	useEffect(() => {
		if (started) return;
		started = true;
		whenIdle(() => void start());
	}, []);
	return children;
}
