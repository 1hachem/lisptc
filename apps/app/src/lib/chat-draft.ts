import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
	$createLineBreakNode,
	$createParagraphNode,
	$createTextNode,
	$getRoot,
	COMMAND_PRIORITY_HIGH,
	KEY_DOWN_COMMAND,
} from "lexical";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	type RecallDirection,
	type Recalled,
	rebase,
	recall,
} from "./message-history.ts";
import { quietly } from "./quietly.ts";

const RECALL_KEYS: Record<string, RecallDirection> = {
	ArrowUp: "back",
	ArrowDown: "forward",
};

function submitsOnEnter(event: KeyboardEvent): boolean {
	return event.key === "Enter" && !event.shiftKey;
}

function sendsQuietly(event: KeyboardEvent): boolean {
	return event.ctrlKey || event.metaKey;
}

function $replaceText(text: string) {
	const paragraph = $createParagraphNode();
	text.split("\n").forEach((line, i) => {
		if (i > 0) paragraph.append($createLineBreakNode());
		if (line) paragraph.append($createTextNode(line));
	});
	$getRoot().clear().append(paragraph);
	paragraph.selectEnd();
}

export function useRecall(history: string[]) {
	const recalled = useRef<Recalled | null>(null);
	const recalledIn = useRef(history);
	return useCallback(
		(text: string, direction: RecallDirection): string | null => {
			const standing =
				recalledIn.current === history
					? recalled.current
					: rebase(recalled.current, history);
			const next = recall(history, standing, text, direction);
			if (!next) return null;
			recalled.current = next.recalled;
			recalledIn.current = history;
			return next.text;
		},
		[history],
	);
}

export function useDraft(
	onSubmit: (text: string) => false | Promise<boolean>,
	disabled: boolean | undefined,
	attached: boolean,
) {
	const [editor] = useLexicalComposerContext();
	const [text, setText] = useState("");
	const latest = useRef("");
	const empty = text.trim() === "" && !attached;

	useEffect(() => {
		editor.setEditable(!disabled);
	}, [editor, disabled]);

	useEffect(
		() =>
			editor.registerTextContentListener((next) => {
				latest.current = next;
				setText(next);
			}),
		[editor],
	);

	const replace = useCallback(
		(next: string) =>
			editor.update(() => $replaceText(next), { discrete: true }),
		[editor],
	);

	const send = useCallback(
		(quiet = false) => {
			if (disabled || empty) return;
			const message = text.trim();
			const outcome = onSubmit(quiet ? quietly(message) : message);
			if (outcome === false) return;
			const draft = text;
			replace("");
			void outcome.then((sent) => {
				if (!sent && latest.current.trim() === "") replace(draft);
			});
		},
		[text, empty, onSubmit, disabled, replace],
	);

	return { text, empty, replace, send };
}

export function useKeys({
	disabled,
	menuActive,
	recall,
	replace,
	enter,
}: {
	disabled?: boolean;
	menuActive: () => boolean;
	recall: (direction: RecallDirection) => string | null;
	replace: (text: string) => void;
	enter?: (quiet: boolean) => void;
}) {
	const [editor] = useLexicalComposerContext();
	const onKeyDown = (event: KeyboardEvent): boolean => {
		if (event.isComposing || disabled) return true;
		if (menuActive()) return false;
		const direction = RECALL_KEYS[event.key];
		const recalled = direction ? recall(direction) : null;
		if (recalled !== null) replace(recalled);
		const handled = direction ? recalled !== null : submitsOnEnter(event);
		if (!handled) return false;
		event.preventDefault();
		if (!direction) enter?.(sendsQuietly(event));
		return true;
	};
	const keys = useRef(onKeyDown);
	keys.current = onKeyDown;
	useEffect(
		() =>
			editor.registerCommand(
				KEY_DOWN_COMMAND,
				(event) => keys.current(event),
				COMMAND_PRIORITY_HIGH,
			),
		[editor],
	);
}
