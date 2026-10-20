import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
	$createLineBreakNode,
	$createTextNode,
	$getRoot,
	$getSelection,
	$isParagraphNode,
	$isRangeSelection,
	COMMAND_PRIORITY_CRITICAL,
	KEY_DOWN_COMMAND,
	type ParagraphNode,
	REDO_COMMAND,
	UNDO_COMMAND,
} from "lexical";
import { useEffect, useRef } from "react";
import {
	leaveInsert,
	normalKey,
	type VimMode,
	type VimStep,
} from "../lib/vim.ts";
import { $offsetIn, $placeAt } from "./lisp-highlight.ts";

function $paragraph(): ParagraphNode | null {
	const root = $getRoot();
	if (root.getChildrenSize() !== 1) return null;
	const first = root.getFirstChild();
	return $isParagraphNode(first) ? first : null;
}

function $caret(paragraph: ParagraphNode): number {
	const selection = $getSelection();
	if (!$isRangeSelection(selection)) return 0;
	return $offsetIn(paragraph, selection.focus) ?? 0;
}

function $write(paragraph: ParagraphNode, text: string) {
	paragraph.clear();
	text.split("\n").forEach((line, i) => {
		if (i > 0) paragraph.append($createLineBreakNode());
		if (line) paragraph.append($createTextNode(line));
	});
}

function $apply(paragraph: ParagraphNode, step: VimStep) {
	if (step.text !== undefined) $write(paragraph, step.text);
	const current = $getSelection();
	const selection = $isRangeSelection(current) ? current : paragraph.select();
	$placeAt(paragraph, selection.anchor, step.caret);
	$placeAt(paragraph, selection.focus, step.caret);
}

function typed(event: KeyboardEvent): boolean {
	return event.key.length === 1 && !event.ctrlKey && !event.metaKey;
}

export function VimKeysPlugin({
	on,
	menuActive,
	onMode,
}: {
	on: boolean;
	menuActive: () => boolean;
	onMode: (mode: VimMode) => void;
}) {
	const [editor] = useLexicalComposerContext();
	const mode = useRef<VimMode>("insert");
	const pending = useRef("");
	const menu = useRef(menuActive);
	menu.current = menuActive;
	const report = useRef(onMode);
	report.current = onMode;

	useEffect(() => {
		if (!on) return;
		const enter = (next: VimMode) => {
			mode.current = next;
			pending.current = "";
			report.current(next);
		};
		const $leave = (event: KeyboardEvent): boolean => {
			if (mode.current !== "insert" || menu.current()) return false;
			event.preventDefault();
			const paragraph = $paragraph();
			if (paragraph) {
				const text = paragraph.getTextContent();
				const caret = leaveInsert(text, $caret(paragraph));
				$apply(paragraph, { caret, pending: "" });
			}
			enter("normal");
			return true;
		};
		const $normal = (event: KeyboardEvent): boolean => {
			if (event.ctrlKey && event.key === "r") {
				event.preventDefault();
				editor.dispatchCommand(REDO_COMMAND, undefined);
				return true;
			}
			if (!typed(event)) return false;
			event.preventDefault();
			const paragraph = $paragraph();
			if (!paragraph) return true;
			const step = normalKey(event.key, {
				text: paragraph.getTextContent(),
				caret: $caret(paragraph),
				pending: pending.current,
			});
			if (!step) return true;
			pending.current = step.pending;
			if (step.history)
				editor.dispatchCommand(
					step.history === "undo" ? UNDO_COMMAND : REDO_COMMAND,
					undefined,
				);
			else $apply(paragraph, step);
			if (step.mode) enter(step.mode);
			return true;
		};
		const unregister = editor.registerCommand(
			KEY_DOWN_COMMAND,
			(event) => {
				if (event.isComposing) return false;
				if (event.key === "Escape") return $leave(event);
				return mode.current === "normal" ? $normal(event) : false;
			},
			COMMAND_PRIORITY_CRITICAL,
		);
		return () => {
			unregister();
			enter("insert");
		};
	}, [editor, on]);

	return null;
}
