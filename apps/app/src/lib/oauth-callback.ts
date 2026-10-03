export const OAUTH_APPROVED_KEY = "lisptc:oauth-approved";

export const RESUME_MESSAGE =
	"I approved the authorization. Carry on with what you were doing.";

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

export function awaitsApproval(
	lines: readonly TranscriptLine[],
	state: string,
): boolean {
	const needle = `state=${state}`;
	let awaiting = false;
	for (const line of lines) {
		if (line.type === "human") awaiting = false;
		else if (line.text.includes(needle)) awaiting = true;
	}
	return awaiting;
}

export function storeApproval(state: string): void {
	try {
		localStorage.setItem(OAUTH_APPROVED_KEY, state);
	} catch {}
}

export function readApproval(): string | null {
	try {
		return localStorage.getItem(OAUTH_APPROVED_KEY);
	} catch {
		return null;
	}
}

export function clearApproval(): void {
	try {
		localStorage.removeItem(OAUTH_APPROVED_KEY);
	} catch {}
}
