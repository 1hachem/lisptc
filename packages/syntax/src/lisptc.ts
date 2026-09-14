import { Language, type Node, Parser } from "web-tree-sitter";

export type SpanKind =
	| "plain"
	| "prose"
	| "delimiter"
	| "head"
	| "symbol"
	| "keyword"
	| "number"
	| "string";

export interface Span {
	at: number;
	text: string;
	kind: SpanKind;
}

export interface Reading {
	spans: Span[];
	openForms: number;
}

export interface Lisptc {
	read(text: string): Reading;
}

export interface LisptcSources {
	grammar: string | Uint8Array;
	runtime?: string;
}

const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)$/;

function atomKind(text: string): SpanKind {
	if (text.startsWith(":")) return "keyword";
	return NUMBER.test(text) ? "number" : "symbol";
}

interface Leaf {
	from: number;
	to: number;
	kind: SpanKind;
	closing?: boolean;
}

function leaves(node: Node, head: boolean, out: Leaf[]): void {
	const leaf = { from: node.startIndex, to: node.endIndex };
	if (node.type === "open" || node.type === "close")
		return void out.push({
			...leaf,
			kind: "delimiter",
			closing: node.type === "close",
		});
	if (node.type === "string") return void out.push({ ...leaf, kind: "string" });
	if (node.type === "prose") return void out.push({ ...leaf, kind: "prose" });
	if (node.type === "atom")
		return void out.push({
			...leaf,
			kind: head ? "head" : atomKind(node.text),
		});

	let seen = 0;
	for (const child of node.children) {
		if (child === null) continue;
		leaves(child, node.type === "form" && seen === 1, out);
		seen += 1;
	}
}

function spansOf(text: string, roots: Leaf[]): Span[] {
	const spans: Span[] = [];
	let at = 0;
	for (const leaf of roots) {
		if (leaf.to <= leaf.from) continue;
		if (leaf.from > at)
			spans.push({ at, text: text.slice(at, leaf.from), kind: "plain" });
		spans.push({
			at: leaf.from,
			text: text.slice(leaf.from, leaf.to),
			kind: leaf.kind,
		});
		at = leaf.to;
	}
	if (at < text.length) spans.push({ at, text: text.slice(at), kind: "plain" });
	return spans;
}

function openForms(leaves: Leaf[]): number {
	let depth = 0;
	for (const leaf of leaves) {
		if (leaf.kind !== "delimiter" || leaf.to <= leaf.from) continue;
		depth += leaf.closing ? -1 : 1;
		if (depth < 0) depth = 0;
	}
	return depth;
}

export async function loadLisptc({
	grammar,
	runtime,
}: LisptcSources): Promise<Lisptc> {
	await Parser.init(runtime ? { locateFile: () => runtime } : undefined);
	const parser = new Parser();
	parser.setLanguage(await Language.load(grammar));
	return {
		read(text) {
			const tree = parser.parse(text);
			if (!tree)
				return { spans: [{ at: 0, text, kind: "plain" }], openForms: 0 };
			const found: Leaf[] = [];
			leaves(tree.rootNode, false, found);
			tree.delete();
			return { spans: spansOf(text, found), openForms: openForms(found) };
		},
	};
}
