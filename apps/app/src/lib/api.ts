import { webEnv } from "@repo/env/web";

export const API_URL = webEnv.VITE_API_URL;

const DISTINCT_ID_KEY = "lisptc.distinct-id";

export function distinctId(): string | undefined {
	if (typeof localStorage === "undefined") return undefined;
	try {
		const existing = localStorage.getItem(DISTINCT_ID_KEY);
		if (existing) return existing;
		const fresh = crypto.randomUUID();
		localStorage.setItem(DISTINCT_ID_KEY, fresh);
		return fresh;
	} catch {
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
