import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { PlainTextPlugin } from "@lexical/react/LexicalPlainTextPlugin";
import { PromptDialog } from "@repo/components";
import { cn } from "@repo/ui";
import {
	$createLineBreakNode,
	$createParagraphNode,
	$createTextNode,
	$getRoot,
	COMMAND_PRIORITY_HIGH,
	KEY_DOWN_COMMAND,
} from "lexical";
import {
	type RefObject,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type { Command } from "../lib/commands.ts";
import {
	newestFirst,
	type RecallDirection,
	type Recalled,
	rebase,
	recall,
} from "../lib/message-history.ts";
import { CommandMenuPlugin } from "./command-menu.tsx";
import { InputAction, InputShell } from "./input-shell.tsx";
import { LispHighlightPlugin, LispTokenNode } from "./lisp-highlight.ts";

export interface ChatInputProps {
	placeholder?: string;
	onSubmit: (text: string) => void;
	history?: string[];
	onCommand?: (name: string) => Promise<string | null>;
	isStreaming?: boolean;
	onStop?: () => void;
	disabled?: boolean;
}

const NOTICE_MS = 2000;

function useNotice(): [string | null, (message: string) => void] {
	const [notice, setNotice] = useState<string | null>(null);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	useEffect(() => () => clearTimeout(timer.current ?? undefined), []);
	const flash = useCallback((message: string) => {
		setNotice(message);
		clearTimeout(timer.current ?? undefined);
		timer.current = setTimeout(() => setNotice(null), NOTICE_MS);
	}, []);
	return [notice, flash];
}

const RECALL_KEYS: Record<string, RecallDirection> = {
	ArrowUp: "back",
	ArrowDown: "forward",
};

function useRecall(history: string[]) {
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

function submitsOnEnter(event: KeyboardEvent): boolean {
	return event.key === "Enter" && !event.shiftKey;
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

function SendAction({
	isStreaming,
	empty,
	disabled,
	onStop,
	onSend,
}: {
	isStreaming?: boolean;
	empty: boolean;
	disabled?: boolean;
	onStop?: () => void;
	onSend: () => void;
}) {
	if (isStreaming && empty)
		return (
			<InputAction
				label="stop"
				glyph="■"
				tone="text-red hover:brightness-125"
				onClick={onStop}
			/>
		);
	if (isStreaming)
		return (
			<InputAction
				label="queue"
				glyph="⏎"
				tone="text-yellow hover:brightness-125"
				onClick={onSend}
			/>
		);
	return (
		<InputAction
			label="send"
			glyph="⏎"
			tone="text-green hover:brightness-125"
			onClick={onSend}
			disabled={disabled}
		/>
	);
}

function useKeys({
	disabled,
	menuActive,
	recall,
	enter,
}: {
	disabled?: boolean;
	menuActive: RefObject<boolean>;
	recall: (direction: RecallDirection) => boolean;
	enter: () => void;
}) {
	const [editor] = useLexicalComposerContext();
	const onKeyDown = (event: KeyboardEvent): boolean => {
		if (event.isComposing || disabled) return true;
		if (menuActive.current) return false;
		const direction = RECALL_KEYS[event.key];
		const handled = direction ? recall(direction) : submitsOnEnter(event);
		if (!handled) return false;
		event.preventDefault();
		if (!direction) enter();
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

function Field({
	placeholder,
	disabled,
}: {
	placeholder: string;
	disabled?: boolean;
}) {
	return (
		<PlainTextPlugin
			contentEditable={
				<ContentEditable
					aria-label={placeholder}
					aria-placeholder={placeholder}
					spellCheck={false}
					placeholder={
						<div className="pointer-events-none absolute inset-0 truncate py-1 text-dim">
							{placeholder}
						</div>
					}
					className={cn(
						"max-h-40 min-h-0 overflow-y-auto [scrollbar-gutter:stable] whitespace-pre-wrap break-words py-1 outline-none",
						disabled ? "cursor-not-allowed text-dim" : "text-fg caret-yellow",
					)}
				/>
			}
			ErrorBoundary={LexicalErrorBoundary}
		/>
	);
}

export function ChatInput(props: ChatInputProps) {
	return (
		<LexicalComposer
			initialConfig={{
				namespace: "chat-input",
				theme: {},
				nodes: [LispTokenNode],
				onError: (error) => {
					throw error;
				},
			}}
		>
			<Editor {...props} />
		</LexicalComposer>
	);
}

function Editor({
	placeholder = "",
	onSubmit,
	history = [],
	onCommand,
	isStreaming,
	onStop,
	disabled,
}: ChatInputProps) {
	const [editor] = useLexicalComposerContext();
	const [text, setText] = useState("");
	const [notice, flash] = useNotice();
	const empty = text.trim() === "";
	const [searching, setSearching] = useState(false);
	const prompts = useMemo(() => newestFirst(history), [history]);
	const step = useRecall(history);

	const replace = useCallback(
		(next: string) =>
			editor.update(() => $replaceText(next), { discrete: true }),
		[editor],
	);

	const insertPrompt = useCallback(
		(prompt: string) => {
			replace(prompt);
			editor.focus();
		},
		[editor, replace],
	);

	const send = useCallback(() => {
		if (disabled || empty) return;
		onSubmit(text.trim());
		replace("");
	}, [text, empty, onSubmit, disabled, replace]);

	const pick = useCallback(
		(command: Command) => {
			if (command.takesArgument) {
				replace(`${command.name} `);
				editor.focus();
				return;
			}
			replace("");
			if (command.name === "/prompt") {
				setSearching(true);
				return;
			}
			void Promise.resolve(onCommand?.(command.name)).then((shown) => {
				if (shown) flash(shown);
			});
		},
		[editor, replace, onCommand, flash],
	);

	const menuHost = useRef<HTMLDivElement>(null);
	const menuActive = useRef(false);

	useEffect(() => {
		editor.setEditable(!disabled);
	}, [editor, disabled]);

	useEffect(() => editor.registerTextContentListener(setText), [editor]);

	useKeys({
		disabled,
		menuActive,
		recall: (direction) => {
			const recalled = step(text, direction);
			if (recalled !== null) replace(recalled);
			return recalled !== null;
		},
		enter: () => (isStreaming && empty ? onStop?.() : send()),
	});

	return (
		<div className="mx-auto flex w-full max-w-[680px] flex-col font-mono text-[13px] leading-[1.7]">
			<div ref={menuHost} />
			{notice && (
				<div className="border-b border-bg2 bg-bg1 px-3 py-0.5 text-dim">
					{notice}
				</div>
			)}
			<InputShell
				prompt={disabled ? "⋯" : "›"}
				tone={disabled ? "text-dim" : "text-green"}
				dim={disabled}
				action={
					<SendAction
						isStreaming={isStreaming}
						empty={empty}
						disabled={disabled}
						onStop={onStop}
						onSend={send}
					/>
				}
			>
				<Field placeholder={placeholder} disabled={disabled} />
			</InputShell>
			<HistoryPlugin />
			<LispHighlightPlugin />
			<CommandMenuPlugin onPick={pick} host={menuHost} active={menuActive} />
			<PromptDialog
				onOpenChange={setSearching}
				onSelect={insertPrompt}
				open={searching}
				prompts={prompts}
			/>
		</div>
	);
}
