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

export function recall(
	history: string[],
	recalled: Recalled | null,
	text: string,
	direction: RecallDirection,
): RecallStep | null {
	const browsing = recalled && recalled.shown === text ? recalled : null;
	if (direction === "back") {
		if (!browsing) {
			if (text.trim() !== "" || history.length === 0) return null;
			return at(history, history.length - 1, text);
		}
		if (browsing.index === 0) return null;
		return at(history, browsing.index - 1, browsing.draft);
	}
	if (!browsing) return null;
	if (browsing.index >= history.length - 1) {
		return { recalled: null, text: browsing.draft };
	}
	return at(history, browsing.index + 1, browsing.draft);
}

function at(history: string[], index: number, draft: string): RecallStep {
	const shown = history[index] ?? "";
	return { recalled: { index, draft, shown }, text: shown };
}
