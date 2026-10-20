import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { tokensIn } from "@repo/syntax";
import {
	$applyNodeReplacement,
	$createTextNode,
	$getRoot,
	$getSelection,
	$isRangeSelection,
	$isTextNode,
	type EditorConfig,
	type LexicalEditor,
	type LexicalNode,
	type NodeKey,
	ParagraphNode,
	type PointType,
	type SerializedTextNode,
	TextNode,
} from "lexical";
import { useEffect } from "react";

export class LispTokenNode extends TextNode {
	__token: string;

	constructor(text = "", token = "", key?: NodeKey) {
		super(text, key);
		this.__token = token;
	}

	static getType(): string {
		return "lisp-token";
	}

	static clone(node: LispTokenNode): LispTokenNode {
		return new LispTokenNode(node.__text, node.__token, node.__key);
	}

	static importJSON(
		json: SerializedTextNode & { token: string },
	): LispTokenNode {
		return new LispTokenNode(json.text, json.token).updateFromJSON(json);
	}

	override isSimpleText(): boolean {
		return !this.isToken() && !this.isSegmented();
	}

	override isUnmergeable(): boolean {
		return true;
	}

	exportJSON(): SerializedTextNode & { token: string } {
		return { ...super.exportJSON(), token: this.__token };
	}

	createDOM(config: EditorConfig, editor?: LexicalEditor): HTMLElement {
		const dom = super.createDOM(config, editor);
		dom.className = `th-${this.__token}`;
		return dom;
	}

	updateDOM(prevNode: this, dom: HTMLElement, config: EditorConfig): boolean {
		const changed = super.updateDOM(prevNode, dom, config);
		if (prevNode.__token !== this.__token) dom.className = `th-${this.__token}`;
		return changed;
	}
}

function $isLispTokenNode(node: LexicalNode): node is LispTokenNode {
	return node instanceof LispTokenNode;
}

interface Segment {
	text: string;
	token?: string;
}

function $createSegment({ text, token }: Segment): TextNode {
	if (token === undefined) return $createTextNode(text);
	return $applyNodeReplacement(new LispTokenNode(text, token));
}

function $segmentOf(node: TextNode): Segment {
	return {
		text: node.getTextContent(),
		token: $isLispTokenNode(node) ? node.getLatest().__token : undefined,
	};
}

const isHighlightable = (node: LexicalNode): node is TextNode =>
	node.getType() === "text" || $isLispTokenNode(node);

function segmentsIn(
	tokens: readonly { value: string; className?: string }[],
	from: number,
	to: number,
): Segment[] {
	const segments: Segment[] = [];
	let tokenStart = 0;
	for (const { value, className } of tokens) {
		const start = Math.max(tokenStart, from);
		const end = Math.min(tokenStart + value.length, to);
		const text = value.slice(start - tokenStart, end - tokenStart);
		tokenStart += value.length;
		if (text === "") continue;
		const last = segments.at(-1);
		if (last && last.token === className) last.text += text;
		else segments.push({ text, token: className });
	}
	return segments;
}

const sameSegments = (a: Segment[], b: Segment[]): boolean =>
	a.length === b.length &&
	a.every((s, i) => s.text === b[i]?.text && s.token === b[i]?.token);

export function $offsetIn(
	paragraph: ParagraphNode,
	point: PointType,
): number | null {
	const node = point.getNode();
	const children = paragraph.getChildren();
	const size = (upTo: number) =>
		children
			.slice(0, upTo)
			.reduce((sum, child) => sum + child.getTextContentSize(), 0);
	if (node.is(paragraph)) return size(point.offset);
	const index = children.findIndex((child) => child.is(node));
	return index < 0 ? null : size(index) + point.offset;
}

export function $placeAt(
	paragraph: ParagraphNode,
	point: PointType,
	offset: number,
) {
	let start = 0;
	let index = 0;
	for (const child of paragraph.getChildren()) {
		const end = start + child.getTextContentSize();
		if ($isTextNode(child) && start <= offset && offset <= end) {
			point.set(child.getKey(), offset - start, "text");
			return;
		}
		if (end <= offset) index += 1;
		start = end;
	}
	point.set(paragraph.getKey(), index, "element");
}

function $highlight(paragraph: ParagraphNode) {
	const tokens = tokensIn(paragraph.getTextContent());
	const runs: { nodes: TextNode[]; from: number; to: number }[] = [];
	let at = 0;
	let run: TextNode[] = [];
	let runFrom = 0;
	const close = () => {
		if (run.length > 0) runs.push({ nodes: run, from: runFrom, to: at });
		run = [];
	};
	for (const child of paragraph.getChildren()) {
		if (isHighlightable(child)) {
			if (run.length === 0) runFrom = at;
			run.push(child);
		} else close();
		at += child.getTextContentSize();
	}
	close();

	const stale = runs
		.map((r) => ({ ...r, wanted: segmentsIn(tokens, r.from, r.to) }))
		.filter((r) => !sameSegments(r.nodes.map($segmentOf), r.wanted));
	if (stale.length === 0) return;

	const selection = $getSelection();
	const kept = $isRangeSelection(selection)
		? {
				anchor: $offsetIn(paragraph, selection.anchor),
				focus: $offsetIn(paragraph, selection.focus),
			}
		: null;

	for (const { nodes, wanted } of stale) {
		const [first] = nodes;
		for (const segment of wanted) first?.insertBefore($createSegment(segment));
		for (const node of nodes) node.remove(true);
	}

	if (!kept || !$isRangeSelection(selection)) return;
	if (kept.anchor !== null) $placeAt(paragraph, selection.anchor, kept.anchor);
	if (kept.focus !== null) $placeAt(paragraph, selection.focus, kept.focus);
}

export function LispHighlightPlugin(): null {
	const [editor] = useLexicalComposerContext();
	useEffect(() => {
		const $rehighlight = (node: LexicalNode) => {
			if (editor.isComposing()) return;
			const paragraph = node instanceof ParagraphNode ? node : node.getParent();
			if (paragraph instanceof ParagraphNode) $highlight(paragraph);
		};
		const unregister = [
			editor.registerNodeTransform(ParagraphNode, $rehighlight),
			editor.registerNodeTransform(TextNode, $rehighlight),
			editor.registerNodeTransform(LispTokenNode, $rehighlight),
		];
		return () => {
			for (const off of unregister) off();
			editor.update(() => {
				for (const node of $getRoot().getAllTextNodes())
					if ($isLispTokenNode(node))
						node.replace($createTextNode(node.getTextContent()));
			});
		};
	}, [editor]);
	return null;
}
