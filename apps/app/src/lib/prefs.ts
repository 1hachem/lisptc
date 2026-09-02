import { createIsomorphicFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";

const YEAR_SECONDS = 60 * 60 * 24 * 365;

export const SIDEBAR_COOKIE = "ui.sidebar";
export const PANEL_COOKIE = "ui.panel";

// Read on both sides so SSR and the first client render agree: the server sees
// the request's Cookie header, the browser its own jar.
const readCookie = createIsomorphicFn()
	.server((name: string) => getCookie(name))
	.client((name: string) =>
		document.cookie
			.split("; ")
			.find((pair) => pair.startsWith(`${name}=`))
			?.slice(name.length + 1),
	);

export function readBoolPref(name: string, fallback: boolean) {
	const raw = readCookie(name);
	if (raw === "true") return true;
	if (raw === "false") return false;
	return fallback;
}

export function writeBoolPref(name: string, value: boolean) {
	if (typeof document === "undefined") return;
	// biome-ignore lint/suspicious/noDocumentCookie: the suggested Cookie Store API is still missing from Safari and Firefox.
	document.cookie = `${name}=${value}; path=/; max-age=${YEAR_SECONDS}; samesite=lax`;
}
