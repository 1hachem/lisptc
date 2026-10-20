import { Attachment01Icon, Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { PlainTextPlugin } from "@lexical/react/LexicalPlainTextPlugin";
import { PromptDialog } from "@repo/components";
import type { SymbolTable } from "@repo/language-service";
import { cn, PromptInputProvider, usePromptInputAttachments } from "@repo/ui";
import {
	$createLineBreakNode,
	$createParagraphNode,
	$createTextNode,
	$getRoot,
	COMMAND_PRIORITY_HIGH,
	KEY_DOWN_COMMAND,
} from "lexical";
import {
	type DragEvent,
	type RefObject,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type { Command } from "../lib/commands.ts";
import { knowledgeIcon } from "../lib/knowledge.ts";
import {
	newestFirst,
	type RecallDirection,
	type Recalled,
	rebase,
	recall,
} from "../lib/message-history.ts";
import { quietly } from "../lib/quietly.ts";
import { CommandMenuPlugin } from "./command-menu.tsx";
import { InputAction, InputShell } from "./input-shell.tsx";
import { LispAssistPlugin } from "./lisp-assist.tsx";
import { LispHighlightPlugin, LispTokenNode } from "./lisp-highlight.ts";
import { type Mentionable, MentionMenuPlugin } from "./mention-menu.tsx";

export interface ChatInputProps {
	placeholder?: string;
	onSubmit: (text: string, files: File[]) => void | Promise<void>;
	history?: string[];
	onCommand?: (name: string) => Promise<string | null>;
	isStreaming?: boolean;
	onStop?: () => void;
	disabled?: boolean;
	mentions?: readonly Mentionable[];
	symbols?: SymbolTable;
	lisp?: boolean;
	send?: boolean;
	sendLabel?: string;
	attach?: boolean;
}

const NO_SYMBOLS: SymbolTable = new Map();

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

function SendAction({
	label,
	isStreaming,
	empty,
	disabled,
	onStop,
	onSend,
}: {
	label: string;
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
			label={label}
			glyph="⏎"
			tone="text-green hover:brightness-125"
			onClick={onSend}
			disabled={disabled}
		/>
	);
}

function usePick({
	replace,
	onCommand,
	flash,
	search,
	attach,
}: {
	replace: (text: string) => void;
	onCommand?: (name: string) => Promise<string | null>;
	flash: (message: string) => void;
	search: (open: boolean) => void;
	attach: () => void;
}) {
	const [editor] = useLexicalComposerContext();
	return useCallback(
		(command: Command) => {
			if (command.takesArgument) {
				replace(`${command.name} `);
				editor.focus();
				return;
			}
			replace("");
			if (command.name === "/prompt") {
				search(true);
				return;
			}
			if (command.name === "/attachment") {
				attach();
				return;
			}
			void Promise.resolve(onCommand?.(command.name)).then((shown) => {
				if (shown) flash(shown);
			});
		},
		[editor, replace, onCommand, flash, search, attach],
	);
}

function useDraft(
	onSubmit: (text: string) => boolean | Promise<boolean>,
	disabled: boolean | undefined,
	attached: boolean,
) {
	const [editor] = useLexicalComposerContext();
	const [text, setText] = useState("");
	const empty = text.trim() === "" && !attached;

	useEffect(() => {
		editor.setEditable(!disabled);
	}, [editor, disabled]);

	useEffect(() => editor.registerTextContentListener(setText), [editor]);

	const replace = useCallback(
		(next: string) =>
			editor.update(() => $replaceText(next), { discrete: true }),
		[editor],
	);

	const send = useCallback(
		(quiet = false) => {
			if (disabled || empty) return;
			const message = text.trim();
			const sent = onSubmit(quiet ? quietly(message) : message);
			if (sent === true) replace("");
			else if (sent !== false)
				void sent.then((done) => {
					if (done) replace("");
				});
		},
		[text, empty, onSubmit, disabled, replace],
	);

	return { text, empty, replace, send };
}

const ENABLED = { prompt: "›", tone: "text-green" };
const DISABLED = { prompt: "⋯", tone: "text-dim" };

function Notice({ text }: { text: string | null }) {
	if (!text) return null;
	return (
		<div className="border-b border-bg2 bg-bg1 px-3 py-0.5 text-dim">
			{text}
		</div>
	);
}

function useKeys({
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

async function asFile(part: {
	url: string;
	filename?: string;
	mediaType: string;
}): Promise<File> {
	const blob = await (await fetch(part.url)).blob();
	return new File([blob], part.filename ?? "file", { type: part.mediaType });
}

function useAttach(
	onSubmit: ChatInputProps["onSubmit"],
	flash: (message: string) => void,
) {
	const attachments = usePromptInputAttachments();
	const [sending, setSending] = useState(false);
	const submit = useCallback(
		(text: string): boolean | Promise<boolean> => {
			if (attachments.files.length === 0) {
				void onSubmit(text, []);
				return true;
			}
			setSending(true);
			return (async () => {
				try {
					await onSubmit(
						text,
						await Promise.all(attachments.files.map(asFile)),
					);
					attachments.clear();
					return true;
				} catch (error) {
					flash(error instanceof Error ? error.message : String(error));
					return false;
				} finally {
					setSending(false);
				}
			})();
		},
		[attachments, onSubmit, flash],
	);
	return { attachments, submit, sending };
}

function AttachAction({
	onClick,
	disabled,
}: {
	onClick: () => void;
	disabled?: boolean;
}) {
	return (
		<button
			type="button"
			aria-label="attach"
			title="attach files"
			onClick={onClick}
			disabled={disabled}
			className={cn(
				"group flex h-auto flex-none items-center self-center rounded-none bg-bg2 px-[9px] py-px text-[11.5px]",
				disabled ? "cursor-not-allowed text-dim" : "text-dim hover:text-fg",
			)}
		>
			<span className="max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-200 ease-out group-hover:mr-[7px] group-hover:max-w-16 group-hover:opacity-100 group-focus-visible:mr-[7px] group-focus-visible:max-w-16 group-focus-visible:opacity-100">
				attach
			</span>
			<HugeiconsIcon
				icon={Attachment01Icon}
				className="size-icon-sm flex-none"
			/>
		</button>
	);
}

function AttachmentChips({
	files,
	onRemove,
}: {
	files: { id: string; filename?: string; mediaType: string }[];
	onRemove: (id: string) => void;
}) {
	if (files.length === 0) return null;
	return (
		<div className="flex flex-wrap gap-1.5 border-b border-bg2 bg-bg1 px-3 py-1">
			{files.map((file) => (
				<span
					key={file.id}
					className="flex h-control-xs items-center gap-1.5 bg-bg2 px-2 text-[11.5px]"
				>
					<HugeiconsIcon
						icon={knowledgeIcon(file.filename ?? "", file.mediaType)}
						className="size-icon-sm text-dim"
					/>
					<span className="max-w-48 truncate">{file.filename}</span>
					<button
						type="button"
						aria-label={`remove ${file.filename}`}
						onClick={() => onRemove(file.id)}
						className="flex items-center text-dim hover:text-red"
					>
						<HugeiconsIcon icon={Cancel01Icon} className="size-icon-xs" />
					</button>
				</span>
			))}
		</div>
	);
}

function useDropZone(add: (files: File[]) => void, disabled?: boolean) {
	const [over, setOver] = useState(false);
	const carriesFiles = (event: DragEvent) =>
		!disabled && event.dataTransfer.types.includes("Files");
	return {
		over,
		zone: {
			onDragOver: (event: DragEvent) => {
				if (!carriesFiles(event)) return;
				event.preventDefault();
				setOver(true);
			},
			onDragLeave: (event: DragEvent) => {
				if (event.currentTarget.contains(event.relatedTarget as Node | null))
					return;
				setOver(false);
			},
			onDrop: (event: DragEvent) => {
				setOver(false);
				if (!carriesFiles(event)) return;
				event.preventDefault();
				add([...event.dataTransfer.files]);
			},
		},
	};
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

function LispPlugins({
	on,
	...props
}: Parameters<typeof LispAssistPlugin>[0] & { on: boolean }) {
	if (!on) return null;
	return (
		<>
			<LispHighlightPlugin />
			<LispAssistPlugin {...props} />
		</>
	);
}

function hintOf(lead: string, lisp: boolean, commands: boolean): string {
	const typed = lisp ? `${lead}, (lisp) runs inline` : lead;
	return commands ? `${typed}  ·  / for commands` : typed;
}

export function ChatInput(props: ChatInputProps) {
	return (
		<PromptInputProvider>
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
		</PromptInputProvider>
	);
}

function useMenus() {
	const host = useRef<HTMLDivElement>(null);
	const commandOpen = useRef(false);
	const mentionOpen = useRef(false);
	const assistOpen = useRef(false);
	const active = useMemo(
		() => ({
			get current() {
				return commandOpen.current || mentionOpen.current || assistOpen.current;
			},
		}),
		[],
	);
	return { host, commandOpen, mentionOpen, assistOpen, active };
}

function FilePicker({
	picker,
	onPick,
}: {
	picker: RefObject<HTMLInputElement | null>;
	onPick: (files: File[]) => void;
}) {
	return (
		<input
			ref={picker}
			type="file"
			multiple
			hidden
			onChange={(event) => {
				const picked = event.target.files;
				if (picked !== null) onPick([...picked]);
				event.target.value = "";
			}}
		/>
	);
}

function noticeOf(sending: boolean, over: boolean, notice: string | null) {
	if (sending) return "attaching…";
	if (over) return "drop to attach";
	return notice;
}

function usePromptSearch(history: string[], replace: (text: string) => void) {
	const [editor] = useLexicalComposerContext();
	const [searching, setSearching] = useState(false);
	const prompts = useMemo(() => newestFirst(history), [history]);
	const insert = useCallback(
		(prompt: string) => {
			replace(prompt);
			editor.focus();
		},
		[editor, replace],
	);
	return { searching, setSearching, prompts, insert };
}

function useComposer({
	onSubmit,
	history = [],
	onCommand,
	isStreaming,
	onStop,
	disabled,
}: ChatInputProps) {
	const [editor] = useLexicalComposerContext();
	const [notice, flash] = useNotice();
	const { attachments, submit, sending } = useAttach(onSubmit, flash);
	const busy = disabled === true || sending;
	const { text, empty, replace, send } = useDraft(
		submit,
		busy,
		attachments.files.length > 0,
	);
	const picker = useRef<HTMLInputElement>(null);
	const attach = useCallback(() => picker.current?.click(), []);
	const { over, zone } = useDropZone(attachments.add, busy);
	const search = usePromptSearch(history, replace);
	const step = useRecall(history);
	const menus = useMenus();
	const pick = usePick({
		replace,
		onCommand,
		flash,
		search: search.setSearching,
		attach,
	});
	const stops = isStreaming === true && empty;

	useKeys({
		disabled: busy,
		menuActive: () => menus.active.current,
		recall: (direction) => step(text, direction),
		replace,
		enter: stops ? onStop : send,
	});

	return {
		attachments,
		busy,
		empty,
		over,
		zone,
		picker,
		attach,
		search,
		menus,
		pick,
		look: busy ? DISABLED : ENABLED,
		notice: noticeOf(sending, over, notice),
		pickFiles: (files: File[]) => {
			attachments.add(files);
			editor.focus();
		},
		sendNow: () => send(),
	};
}

function Editor(props: ChatInputProps) {
	const {
		placeholder = "",
		onCommand,
		isStreaming,
		onStop,
		mentions = [],
		symbols = NO_SYMBOLS,
		lisp = true,
		send = true,
		sendLabel = "send",
		attach = true,
	} = props;
	const c = useComposer(props);

	return (
		<div
			{...c.zone}
			className={cn(
				"relative mx-auto flex w-full max-w-[680px] flex-col font-mono text-[13px] leading-[1.7]",
				c.over && "outline outline-1 outline-dashed outline-yellow",
			)}
		>
			<FilePicker picker={c.picker} onPick={c.pickFiles} />
			<div
				ref={c.menus.host}
				className="absolute inset-x-0 bottom-full z-10 flex flex-col"
			>
				<Notice text={c.notice} />
			</div>
			<AttachmentChips
				files={c.attachments.files}
				onRemove={c.attachments.remove}
			/>
			<InputShell
				prompt={c.look.prompt}
				tone={c.look.tone}
				dim={c.busy}
				action={
					<>
						{attach && <AttachAction onClick={c.attach} disabled={c.busy} />}
						{send && (
							<SendAction
								label={sendLabel}
								isStreaming={isStreaming}
								empty={c.empty}
								disabled={c.busy}
								onStop={onStop}
								onSend={c.sendNow}
							/>
						)}
					</>
				}
			>
				<Field
					placeholder={hintOf(placeholder, lisp, onCommand !== undefined)}
					disabled={c.busy}
				/>
			</InputShell>
			<HistoryPlugin />
			<CommandMenuPlugin
				onPick={c.pick}
				host={c.menus.host}
				active={c.menus.commandOpen}
			/>
			<MentionMenuPlugin
				files={mentions}
				host={c.menus.host}
				active={c.menus.mentionOpen}
			/>
			<LispPlugins
				on={lisp}
				symbols={symbols}
				host={c.menus.host}
				active={c.menus.assistOpen}
			/>
			<PromptDialog
				onOpenChange={c.search.setSearching}
				onSelect={c.search.insert}
				open={c.search.searching}
				prompts={c.search.prompts}
			/>
		</div>
	);
}
