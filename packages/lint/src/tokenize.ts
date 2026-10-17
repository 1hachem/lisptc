import { tokenPattern } from "@repo/shared/lisp-tokens";

export interface Atom {
	kind: "atom";
	text: string;
	line: number;
	char: number;
	quoted?: true;
}
export interface ListForm {
	kind: "list";
	items: Node[];
	openLine: number;
	openChar: number;
	closeLine: number;
	closeChar: number;
	quoted?: true;
}
export type Node = Atom | ListForm;

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

export function parseForms(tokens: Atom[]): Node[] {
	let i = 0;
	function parseOne(): Node | undefined {
		const t = tokens[i];
		if (t === undefined || t.text === ")") {
			if (t !== undefined) i++;
			return undefined;
		}
		if (t.text === "'" || t.text === "`") {
			i++;
			const datum = parseOne();
			return datum === undefined ? datum : { ...datum, quoted: true };
		}
		if (t.text === "," || t.text === ",@") {
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
	values: Map<string, Node>;
	argCount: number;
}

function isKeyword(node: Node): node is Atom {
	return node.kind === "atom" && !node.quoted && node.text.startsWith(":");
}

export function callOf(form: ListForm): Call | undefined {
	const [head, ...rest] = form.items;
	if (head?.kind !== "atom" || head.text.startsWith(":")) return undefined;
	const keywords = new Set(rest.filter(isKeyword).map((k) => k.text.slice(1)));
	const values = new Map<string, Node>();
	rest.forEach((item, i) => {
		const value = rest[i + 1];
		if (isKeyword(item) && value !== undefined && !isKeyword(value))
			values.set(item.text.slice(1), value);
	});
	return { name: head.text, head, keywords, values, argCount: rest.length };
}

export function collectCalls(nodes: Node[], out: Call[] = []): Call[] {
	for (const n of nodes) {
		if (n.kind !== "list") continue;
		const call = callOf(n);
		if (call !== undefined) out.push(call);
		collectCalls(n.items, out);
	}
	return out;
}
