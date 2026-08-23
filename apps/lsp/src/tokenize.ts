// Tokenizing/parsing lisptc source into a tree of positioned atoms and list
// forms, and collecting the call sites within it. Static analysis only (the
// buffer is never evaluated) — see call-diagnostics.ts for what consumes this.
import { tokenPattern } from "@repo/interpreter";

export interface Atom {
	kind: "atom";
	text: string;
	line: number;
	char: number;
}
interface ListForm {
	kind: "list";
	items: Node[];
	openLine: number;
	openChar: number;
	closeLine: number;
	closeChar: number;
}
export type Node = Atom | ListForm;

// Tokenize with (line, char) positions, using the interpreter's own reader
// grammar (see tokenPattern in packages/interpreter/src/lisp.ts) so forms
// line up with what it would actually read.
export function tokenizeWithPositions(text: string): Atom[] {
	const tokenPat = tokenPattern();
	const tokens: Atom[] = [];
	const lines = text.split("\n");
	for (let line = 0; line < lines.length; line++) {
		const s = lines[line];
		for (;;) {
			const m = tokenPat.exec(s);
			if (m === null) break;
			if (m[1] !== undefined)
				tokens.push({ kind: "atom", text: m[1], line, char: m.index });
		}
	}
	return tokens;
}

// Parse tokens into a tree of lists/atoms with positions. Best-effort: stray
// unmatched parens aren't specially handled — this only needs to find call
// forms `(head ...)` and their direct arguments, which is enough for a
// static, non-evaluating check.
export function parseForms(tokens: Atom[]): Node[] {
	let i = 0;
	function parseOne(): Node | undefined {
		const t = tokens[i];
		if (t === undefined || t.text === ")") {
			if (t !== undefined) i++;
			return undefined;
		}
		if (t.text === "'" || t.text === "`" || t.text === "," || t.text === ",@") {
			// Reader sugar for (quote x)/(quasiquote x)/etc: one logical argument,
			// not two, so collapse into whatever it prefixes — otherwise e.g. 'x
			// as an arg would inflate the caller's positional argument count.
			i++;
			return parseOne();
		}
		if (t.text !== "(") {
			i++;
			return t;
		}
		i++;
		const items: Node[] = [];
		while (tokens[i] !== undefined && tokens[i].text !== ")") {
			const item = parseOne();
			if (item !== undefined) items.push(item);
		}
		const close = tokens[i];
		if (close !== undefined) i++;
		return {
			kind: "list",
			items,
			openLine: t.line,
			openChar: t.char,
			closeLine: close?.line ?? t.line,
			closeChar: close?.char ?? t.char,
		};
	}
	const forms: Node[] = [];
	for (let f = parseOne(); f !== undefined; f = parseOne()) forms.push(f);
	return forms;
}

export interface Call {
	name: string;
	head: Atom;
	keywords: Set<string>;
	argCount: number;
}

// Every call form `(head ...)` found anywhere in the program (including
// nested), with the head symbol's position, the `:keyword` names passed
// directly to it (not through a nested form, since those belong to a
// different call), and the total count of direct arguments (for arity
// checking; quote-prefixed forms already collapse to one node each).
export function collectCalls(nodes: Node[], out: Call[] = []): Call[] {
	for (const n of nodes) {
		if (n.kind !== "list") continue;
		const [head, ...rest] = n.items;
		if (head?.kind === "atom" && !head.text.startsWith(":")) {
			const keywords = new Set(
				rest
					.filter(
						(item): item is Atom =>
							item.kind === "atom" && item.text.startsWith(":"),
					)
					.map((item) => item.text.slice(1)),
			);
			out.push({ name: head.text, head, keywords, argCount: rest.length });
		}
		collectCalls(n.items, out);
	}
	return out;
}
