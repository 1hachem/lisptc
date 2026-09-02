/**
 * The app's API client surface: where the API is, and who is asking.
 */

import { webEnv } from "@repo/env/web";

export const API_URL = webEnv.VITE_API_URL;

const DISTINCT_ID_KEY = "lisptc.distinct-id";

/**
 * A stable per-browser id. Not an account — it exists so one person's traces
 * group together in PostHog, locally today and for real users later, without
 * an auth system having to exist first.
 */
export function distinctId(): string | undefined {
	if (typeof localStorage === "undefined") return undefined;
	try {
		const existing = localStorage.getItem(DISTINCT_ID_KEY);
		if (existing) return existing;
		const fresh = crypto.randomUUID();
		localStorage.setItem(DISTINCT_ID_KEY, fresh);
		return fresh;
	} catch {
		// private mode / storage disabled — traces stay anonymous, which is fine
		return undefined;
	}
}

export function apiHeaders(): Record<string, string> {
	const id = distinctId();
	return {
		"content-type": "application/json",
		...(id ? { "x-distinct-id": id } : {}),
	};
}
