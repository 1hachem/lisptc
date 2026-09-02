/**
 * Browser-side PostHog: pageviews, autocapture, web vitals, exceptions.
 *
 * Not where traces or notes come from — those are captured server-side so an
 * event cannot drift into a different project than the run it describes (see
 * devdocs/telemetry.md). This half answers the questions the server cannot see
 * at all: who opened the app and never sent a message, where they gave up.
 *
 * `PostHogProvider` initialises inside an effect, so it never runs during SSR,
 * and puts the client on context for `usePostHog()` in any component that wants
 * to capture something by hand.
 *
 * Off in dev. A local session is one person reloading the same page, and it
 * would land in the same project as the real traffic — the pageview and
 * bounce numbers this exists to answer are the ones it would distort. Agent
 * traces are not affected: those are captured server-side and are worth having
 * for a local run, which is the whole point of `POSTHOG_ENVIRONMENT`.
 */

import { PostHogProvider } from "@posthog/react";
import { webEnv } from "@repo/env/web";
import posthog, { type PostHogConfig } from "posthog-js";
import type { ReactNode } from "react";
import { API_URL, distinctId } from "./api.ts";

const ENVIRONMENT = webEnv.VITE_ENVIRONMENT;
const ENABLED = ENVIRONMENT !== "dev";

// Same-origin, so content blockers have no analytics domain to match and our
// own cookies are not sent to anyone (the proxy strips them). Kept in step with
// the directory name under `server/routes/`, which is the route that answers it.
const PROXY_PATH = "/ingest";

const OPTIONS: Partial<PostHogConfig> = {
	api_host: PROXY_PATH,
	// With a proxied `api_host` posthog-js can no longer work out which region
	// owns the project, and every "view in PostHog" link — the toolbar's
	// included — would point back at the proxy path.
	ui_host: "https://us.posthog.com",
	// Opt into the current defaults rather than the 2015 ones. The two that
	// matter here: a pageview per history change (this is an SPA, so a route
	// change is the only pageview there is) and person profiles for identified
	// users only.
	defaults: "2026-05-30",
	capture_exceptions: true,
	// Adds `X-POSTHOG-SESSION-ID` to requests to the API, which is what lets a
	// server-side `$ai_trace` point at the session replay of the person who
	// caused it. Hostname only — a value with a port in it matches nothing.
	tracing_headers: [new URL(API_URL).hostname],
	// The id the API headers already carry, so a click here and the trace it
	// produced land on one person. Left anonymous deliberately: this is a
	// per-browser uuid, not an account, and `isIdentifiedID` on a random id
	// mints a person profile for a person who does not exist. When there is a
	// real login, that is where `identify()` and `reset()` belong.
	bootstrap: { distinctID: distinctId() },
	// `environment` on every event, matching the property the server-side events
	// carry, so one project can separate local runs from deployed ones on both
	// halves at once. Registered here rather than through `posthog.register`
	// because the provider captures the first pageview during init, before any
	// effect of ours could run.
	before_send: (event) => {
		if (event)
			event.properties = { ...event.properties, environment: ENVIRONMENT };
		return event;
	},
};

/**
 * One question, two events. `survey sent` carrying `$ai_trace_id` is the shape
 * PostHog renders *inside* the trace, so a rating shows up on the run it is
 * about rather than in a table of its own; `$survey_submission_id` is what ties
 * a thumb and the sentence that follows it into one response.
 *
 * Goes through the module singleton rather than `usePostHog()` so the feedback
 * UI can render in dev, where the provider is not mounted and there is nothing
 * on context — the capture is what turns off, not the affordance.
 */
export function captureFeedback(properties: Record<string, unknown>): void {
	if (!ENABLED) return;
	posthog.capture("survey sent", {
		$survey_id: webEnv.VITE_POSTHOG_SURVEY_ID,
		...properties,
	});
}

/**
 * Wraps the app in PostHog outside dev, and is the identity function inside it —
 * nothing initialises, so no request is made and no `posthog` lands on context.
 */
export function Analytics({ children }: { children: ReactNode }) {
	if (!ENABLED) return children;
	return (
		<PostHogProvider apiKey={webEnv.VITE_POSTHOG_KEY} options={OPTIONS}>
			{children}
		</PostHogProvider>
	);
}
