export type VimMode = "insert" | "normal";

export interface VimState {
	text: string;
	caret: number;
	pending: string;
}

export interface VimStep {
	text?: string;
	caret: number;
	mode?: VimMode;
	pending: string;
	history?: "undo" | "redo";
}

function lineStart(text: string, caret: number): number {
	return text.lastIndexOf("\n", caret - 1) + 1;
}

function lineEnd(text: string, caret: number): number {
	const end = text.indexOf("\n", caret);
	return end < 0 ? text.length : end;
}

function lastOnLine(text: string, caret: number): number {
	return Math.max(lineStart(text, caret), lineEnd(text, caret) - 1);
}

function settle(text: string, caret: number): number {
	return Math.min(Math.max(caret, 0), lastOnLine(text, caret));
}

function firstBlank(text: string, caret: number): number {
	const start = lineStart(text, caret);
	const end = lineEnd(text, caret);
	let at = start;
	while (at < end && /[ \t]/.test(text[at] ?? "")) at++;
	return at;
}

type CharClass = "space" | "word" | "punct";

function classOf(char: string | undefined): CharClass {
	if (char === undefined || /\s/.test(char)) return "space";
	return /\w/.test(char) ? "word" : "punct";
}

function wordForward(text: string, caret: number): number {
	let at = caret;
	const from = classOf(text[at]);
	if (from !== "space")
		while (at < text.length && classOf(text[at]) === from) at++;
	while (at < text.length && classOf(text[at]) === "space") at++;
	return Math.min(at, Math.max(text.length - 1, 0));
}

function wordBackward(text: string, caret: number): number {
	let at = caret - 1;
	while (at > 0 && classOf(text[at]) === "space") at--;
	const from = classOf(text[at]);
	while (at > 0 && classOf(text[at - 1]) === from) at--;
	return Math.max(at, 0);
}

function wordEnd(text: string, caret: number): number {
	let at = caret + 1;
	while (at < text.length && classOf(text[at]) === "space") at++;
	const from = classOf(text[at]);
	while (at + 1 < text.length && classOf(text[at + 1]) === from) at++;
	return Math.min(at, Math.max(text.length - 1, 0));
}

function lineAbove(text: string, caret: number): number {
	const start = lineStart(text, caret);
	if (start === 0) return caret;
	const above = lineStart(text, start - 1);
	return Math.min(above + caret - start, lastOnLine(text, above));
}

function lineBelow(text: string, caret: number): number {
	const end = lineEnd(text, caret);
	if (end === text.length) return caret;
	const below = end + 1;
	return Math.min(
		below + caret - lineStart(text, caret),
		lastOnLine(text, below),
	);
}

function deleteLine(text: string, caret: number): VimStep {
	const start = lineStart(text, caret);
	const end = lineEnd(text, caret);
	const last = end === text.length;
	const cut = last ? Math.max(start - 1, 0) : start;
	const next = text.slice(0, cut) + text.slice(last ? end : end + 1);
	const at = last ? lineStart(next, cut) : cut;
	return { text: next, caret: firstBlank(next, at), pending: "" };
}

function insertAt(caret: number): VimStep {
	return { caret, mode: "insert", pending: "" };
}

function opened(text: string, at: number): VimStep {
	return {
		text: `${text.slice(0, at)}\n${text.slice(at)}`,
		caret: at,
		mode: "insert",
		pending: "",
	};
}

const MOTIONS: Record<string, (text: string, caret: number) => number> = {
	h: (text, caret) => Math.max(lineStart(text, caret), caret - 1),
	l: (text, caret) => Math.min(lastOnLine(text, caret), caret + 1),
	j: lineBelow,
	k: lineAbove,
	w: wordForward,
	b: wordBackward,
	e: wordEnd,
	"0": lineStart,
	"^": firstBlank,
	$: lastOnLine,
	G: (text) => firstBlank(text, text.length),
};

function pendingStep(key: string, { text, caret, pending }: VimState): VimStep {
	if (pending === "d" && key === "d") return deleteLine(text, caret);
	if (pending === "g" && key === "g")
		return { caret: firstBlank(text, 0), pending: "" };
	return { caret, pending: "" };
}

function edit(key: string, { text, caret }: VimState): VimStep | null {
	const end = lineEnd(text, caret);
	switch (key) {
		case "x": {
			if (caret >= end) return { caret, pending: "" };
			const next = text.slice(0, caret) + text.slice(caret + 1);
			return { text: next, caret: settle(next, caret), pending: "" };
		}
		case "D": {
			const next = text.slice(0, caret) + text.slice(end);
			return { text: next, caret: settle(next, caret), pending: "" };
		}
		case "i":
			return insertAt(caret);
		case "a":
			return insertAt(Math.min(caret + 1, end));
		case "I":
			return insertAt(firstBlank(text, caret));
		case "A":
			return insertAt(end);
		case "o":
			return { ...opened(text, end), caret: end + 1 };
		case "O":
			return opened(text, lineStart(text, caret));
		case "u":
			return { caret, pending: "", history: "undo" };
		default:
			return null;
	}
}

export function normalKey(key: string, state: VimState): VimStep | null {
	if (state.pending !== "") return pendingStep(key, state);
	if (key === "d" || key === "g") return { caret: state.caret, pending: key };
	const motion = MOTIONS[key];
	if (motion) return { caret: motion(state.text, state.caret), pending: "" };
	return edit(key, state);
}

export function leaveInsert(text: string, caret: number): number {
	return Math.max(lineStart(text, caret), caret - 1);
}
