export interface Recalled {
	index: number;
	draft: string;
	shown: string;
}

export type RecallDirection = "back" | "forward";

export interface RecallStep {
	recalled: Recalled | null;
	text: string;
}

export function sentHistory(sent: string[]): string[] {
	return sent
		.map((text) => text.trim())
		.filter((text, i, all) => text !== "" && text !== all[i - 1]);
}

export function newestFirst(history: string[]): string[] {
	return [...new Set([...history].reverse())];
}

export function rebase(
	recalled: Recalled | null,
	history: string[],
): Recalled | null {
	if (!recalled) return null;
	const index = history.lastIndexOf(recalled.shown);
	return index === -1 ? null : { ...recalled, index };
}

export function recall(
	history: string[],
	recalled: Recalled | null,
	text: string,
	direction: RecallDirection,
): RecallStep | null {
	const browsing = recalled && recalled.shown === text ? recalled : null;
	const draft = browsing ? browsing.draft : text;
	const matches = matching(draft);
	if (direction === "back") {
		const from = browsing ? browsing.index - 1 : history.length - 1;
		for (let i = from; i >= 0; i--) {
			if (matches(history[i] ?? "")) return at(history, i, draft);
		}
		return null;
	}
	if (!browsing) return null;
	for (let i = browsing.index + 1; i < history.length; i++) {
		if (matches(history[i] ?? "")) return at(history, i, draft);
	}
	return { recalled: null, text: draft };
}

function matching(draft: string): (entry: string) => boolean {
	const query = draft.trim().toLowerCase();
	return (entry) =>
		entry.toLowerCase().includes(query) && entry !== draft.trim();
}

function at(history: string[], index: number, draft: string): RecallStep {
	const shown = history[index] ?? "";
	return { recalled: { index, draft, shown }, text: shown };
}
