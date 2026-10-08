import { defaultThemeId, themes } from "@repo/ui";
import { createIsomorphicFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";

const YEAR_SECONDS = 60 * 60 * 24 * 365;

export const SIDEBAR_COOKIE = "ui.sidebar";
export const PANEL_COOKIE = "ui.panel";
const THEME_COOKIE = "ui.theme";

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
	writeCookie(name, String(value));
}

export function readThemePref() {
	const raw = readCookie(THEME_COOKIE);
	return themes.find((theme) => theme.id === raw)?.id ?? defaultThemeId;
}

export function writeThemePref(id: string) {
	writeCookie(THEME_COOKIE, id);
	document.documentElement.dataset.theme = id;
}

function writeCookie(name: string, value: string) {
	if (typeof document === "undefined") return;
	// biome-ignore lint/suspicious/noDocumentCookie: the suggested Cookie Store API is still missing from Safari and Firefox.
	document.cookie = `${name}=${value}; path=/; max-age=${YEAR_SECONDS}; samesite=lax`;
}
