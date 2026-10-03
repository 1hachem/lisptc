export const OAUTH_CALLBACK_KEY = "lisptc:oauth-callback";

export interface TranscriptLine {
	type: string;
	text: string;
}

export function callbackState(url: string): string | undefined {
	try {
		return new URL(url).searchParams.get("state") ?? undefined;
	} catch {
		return undefined;
	}
}

export function awaitsCallback(
	lines: readonly TranscriptLine[],
	url: string,
): boolean {
	const state = callbackState(url);
	if (!state) return false;
	const needle = `state=${state}`;
	const issued = lines.some(
		(l) => l.type !== "human" && l.text.includes(needle),
	);
	const answered = lines.some(
		(l) => l.type === "human" && l.text.includes(needle),
	);
	return issued && !answered;
}

export function resumeMessage(url: string): string {
	return `I approved the authorization. Finish it with this callback link and carry on: ${url}`;
}

export function storeCallback(url: string): void {
	try {
		localStorage.setItem(OAUTH_CALLBACK_KEY, url);
	} catch {}
}

export function readCallback(): string | null {
	try {
		return localStorage.getItem(OAUTH_CALLBACK_KEY);
	} catch {
		return null;
	}
}

export function clearCallback(): void {
	try {
		localStorage.removeItem(OAUTH_CALLBACK_KEY);
	} catch {}
}
