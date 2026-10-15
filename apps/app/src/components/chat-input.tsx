import { PromptDialog } from "@repo/components";
import { cn } from "@repo/ui";
import {
	type KeyboardEvent,
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
import { CommandMenu, useCommandMenu } from "./command-menu.tsx";
import { InputAction, InputShell } from "./input-shell.tsx";
import { LispText } from "./lisp-text.tsx";

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

function submitsOnEnter(event: KeyboardEvent<HTMLTextAreaElement>): boolean {
	return event.key === "Enter" && !event.shiftKey;
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

export function ChatInput({
	placeholder = "",
	onSubmit,
	history = [],
	onCommand,
	isStreaming,
	onStop,
	disabled,
}: ChatInputProps) {
	const [text, setText] = useState("");
	const area = useRef<HTMLTextAreaElement>(null);
	const mirror = useRef<HTMLPreElement>(null);
	const [notice, flash] = useNotice();
	const empty = text.trim() === "";
	const [searching, setSearching] = useState(false);
	const prompts = useMemo(() => newestFirst(history), [history]);
	const step = useRecall(history);

	const insertPrompt = useCallback((prompt: string) => {
		setText(prompt);
		area.current?.focus();
	}, []);

	const send = useCallback(() => {
		if (disabled || empty) return;
		onSubmit(text.trim());
		setText("");
	}, [text, empty, onSubmit, disabled]);

	const pick = useCallback(
		(command: Command) => {
			if (command.takesArgument) {
				setText(`${command.name} `);
				area.current?.focus();
				return;
			}
			setText("");
			if (command.name === "/prompt") {
				setSearching(true);
				return;
			}
			void Promise.resolve(onCommand?.(command.name)).then((shown) => {
				if (shown) flash(shown);
			});
		},
		[onCommand, flash],
	);

	const menu = useCommandMenu(text, pick);

	const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		if (disabled || event.nativeEvent.isComposing || menu.handleKey(event))
			return;
		const direction = RECALL_KEYS[event.key];
		if (direction) {
			const recalled = step(text, direction);
			if (recalled === null) return;
			event.preventDefault();
			setText(recalled);
			return;
		}
		if (!submitsOnEnter(event)) return;
		event.preventDefault();
		if (isStreaming && empty) onStop?.();
		else send();
	};

	return (
		<div className="mx-auto flex w-full max-w-[680px] flex-col font-mono text-[13px] leading-[1.7]">
			<CommandMenu menu={menu} onPick={pick} />
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
				<pre
					ref={mirror}
					aria-hidden
					className={cn(
						"pointer-events-none max-h-40 overflow-hidden [scrollbar-gutter:stable] whitespace-pre-wrap break-words px-0 py-1 font-[inherit] text-[length:inherit]",
						disabled ? "text-dim" : "text-fg",
					)}
				>
					<LispText>{text}</LispText>
					{"\n"}
				</pre>
				{text === "" && (
					<div className="pointer-events-none absolute inset-0 truncate py-1 text-dim">
						{placeholder}
					</div>
				)}
				<textarea
					ref={area}
					value={text}
					aria-label={placeholder}
					spellCheck={false}
					readOnly={disabled}
					onChange={(event) => {
						setText(event.target.value);
						menu.select(0);
					}}
					onScroll={() => {
						if (mirror.current && area.current)
							mirror.current.scrollTop = area.current.scrollTop;
					}}
					onKeyDown={onKeyDown}
					className={cn(
						"absolute inset-0 resize-none overflow-y-auto [scrollbar-gutter:stable] border-0 bg-transparent px-0 py-1 text-transparent outline-none",
						disabled ? "cursor-not-allowed" : "caret-yellow",
					)}
				/>
			</InputShell>
			<PromptDialog
				onOpenChange={setSearching}
				onSelect={insertPrompt}
				open={searching}
				prompts={prompts}
			/>
		</div>
	);
}
