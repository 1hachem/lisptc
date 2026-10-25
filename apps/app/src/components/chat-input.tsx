import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { PlainTextPlugin } from "@lexical/react/LexicalPlainTextPlugin";
import { PromptDialog } from "@repo/components";
import type { Question } from "@repo/interpreter/annotations";
import type { SymbolTable } from "@repo/language-service";
import { Button, cn } from "@repo/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	type FileTransfer,
	type SubmitMessage,
	useAttachedSend,
} from "../lib/attachments.ts";
import { useDraft, useKeys, useRecall } from "../lib/chat-draft.ts";
import { useMenus, usePick, usePromptSearch } from "../lib/chat-menus.ts";
import { useDropZone } from "../lib/drop-zone.ts";
import type { InputHelper } from "../lib/input-helpers.ts";
import { useNotice } from "../lib/notice.ts";
import { answerOf } from "../lib/question.ts";
import {
	AttachAction,
	AttachmentChips,
	FilePicker,
} from "./attachment-chips.tsx";
import { CommandMenuPlugin } from "./command-menu.tsx";
import { InputAction, InputShell } from "./input-shell.tsx";
import { LispAssistPlugin } from "./lisp-assist.tsx";
import { LispHighlightPlugin, LispTokenNode } from "./lisp-highlight.ts";
import { type Mentionable, MentionMenuPlugin } from "./mention-menu.tsx";

export interface Streaming {
	active: boolean;
	onStop: () => void;
}

export interface Assist {
	history?: string[];
	onCommand?: (name: string) => Promise<string | null>;
	mentions?: readonly Mentionable[];
	symbols?: SymbolTable;
}

export interface ChatInputProps {
	placeholder?: string;
	onSubmit: SubmitMessage;
	blocked?: string;
	disabled?: boolean;
	streaming?: Streaming;
	files?: FileTransfer;
	assist?: Assist;
	on?: Partial<Record<InputHelper, boolean>>;
	question?: Question;
}

const NO_SYMBOLS: SymbolTable = new Map();

const NO_HISTORY: string[] = [];

const ENABLED = { prompt: "›", tone: "text-green" };
const DISABLED = { prompt: "⋯", tone: "text-dim" };

function SendAction({
	streaming,
	empty,
	disabled,
	blocked,
	onSend,
}: {
	streaming?: Streaming;
	empty: boolean;
	disabled?: boolean;
	blocked?: string;
	onSend: () => void;
}) {
	if (streaming?.active && empty)
		return (
			<InputAction
				label="stop"
				glyph="■"
				tone="text-red hover:brightness-125"
				onClick={streaming.onStop}
			/>
		);
	if (streaming?.active)
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
			disabled={disabled || blocked !== undefined}
			title={blocked}
		/>
	);
}

function Notice({ text }: { text: string | null }) {
	if (!text) return null;
	return (
		<div className="border-b border-bg2 bg-bg1 px-3 py-0.5 text-dim">
			{text}
		</div>
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

function noticeOf(over: boolean, notice: string | null) {
	if (over) return "drop to attach";
	return notice;
}

const PICKABLE = 9;

function typingIn(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	return (
		target.isContentEditable ||
		target instanceof HTMLInputElement ||
		target instanceof HTMLTextAreaElement ||
		target instanceof HTMLSelectElement
	);
}

function pickedBy(key: string, choices: number): number | undefined {
	const at = Number(key) - 1;
	return Number.isInteger(at) && at >= 0 && at < Math.min(choices, PICKABLE)
		? at
		: undefined;
}

function usePickerKeys(handlers: {
	pick: (at: number) => void;
	submit: () => void;
	dismiss: () => void;
	choices: number;
	multi: boolean;
}) {
	const latest = useRef(handlers);
	latest.current = handlers;
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.defaultPrevented || event.isComposing) return;
			if (event.ctrlKey || event.metaKey || event.altKey) return;
			if (typingIn(event.target)) return;
			const { pick, submit, dismiss, choices, multi } = latest.current;
			const at = pickedBy(event.key, choices);
			if (at !== undefined) pick(at);
			else if (event.key === "Escape") dismiss();
			else if (event.key === "Enter" && multi) submit();
			else return;
			event.preventDefault();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);
}

function QuestionPicker({
	question,
	disabled,
	onAnswer,
	onDismiss,
}: {
	question: Question;
	disabled?: boolean;
	onAnswer: (text: string) => void;
	onDismiss: () => void;
}) {
	const [checked, setChecked] = useState<ReadonlySet<number>>(new Set());
	const submit = () => {
		if (disabled || checked.size === 0) return;
		onAnswer(
			answerOf(
				question,
				[...checked].sort((a, b) => a - b),
			),
		);
	};
	const pick = (at: number) => {
		if (disabled) return;
		if (!question.multi) {
			onAnswer(answerOf(question, [at]));
			return;
		}
		setChecked((current) => {
			const next = new Set(current);
			if (!next.delete(at)) next.add(at);
			return next;
		});
	};
	usePickerKeys({
		pick,
		submit,
		dismiss: onDismiss,
		choices: question.choices.length,
		multi: question.multi,
	});

	return (
		<div className="relative mx-auto flex w-full max-w-[680px] flex-col font-mono text-[13px] leading-[1.7]">
			<InputShell
				prompt="?"
				tone="text-yellow"
				dim={disabled}
				action={
					<>
						<InputAction
							label="type instead"
							glyph="esc"
							tone="text-dim hover:text-fg"
							onClick={onDismiss}
						/>
						{question.multi && (
							<InputAction
								label="send"
								glyph="⏎"
								tone="text-green hover:brightness-125"
								onClick={submit}
								disabled={disabled || checked.size === 0}
							/>
						)}
					</>
				}
			>
				<fieldset
					aria-label={question.prompt}
					className="flex min-w-0 flex-col gap-1.5 py-1"
				>
					<legend className="whitespace-pre-wrap break-words text-fg">
						{question.prompt}
					</legend>
					<div className="flex flex-wrap gap-1.5">
						{question.choices.map((choice, at) => (
							<Button
								key={choice}
								type="button"
								size="sm"
								variant={checked.has(at) ? "secondary" : "outline"}
								aria-pressed={question.multi ? checked.has(at) : undefined}
								disabled={disabled}
								onClick={() => pick(at)}
								className="min-w-0 max-w-full shrink rounded-none font-mono"
							>
								{at < PICKABLE && <span className="text-dim">{at + 1}</span>}
								<span className="min-w-0 truncate">{choice}</span>
							</Button>
						))}
					</div>
				</fieldset>
			</InputShell>
		</div>
	);
}

function useOpenQuestion(question: Question | undefined, streaming: boolean) {
	const [typing, setTyping] = useState<string | undefined>(undefined);
	const open =
		question !== undefined && !streaming && typing !== question.id
			? question
			: undefined;
	const dismiss = useCallback(() => setTyping(question?.id), [question]);
	return {
		open,
		dismiss,
		typed: question !== undefined && typing === question.id,
	};
}

export function ChatInput(props: ChatInputProps) {
	const { open, dismiss, typed } = useOpenQuestion(
		props.question,
		props.streaming?.active === true,
	);
	if (open)
		return (
			<QuestionPicker
				key={open.id}
				question={open}
				disabled={props.disabled}
				onAnswer={(text) => void props.onSubmit(text, [])}
				onDismiss={dismiss}
			/>
		);
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
			{typed && <FocusOnMount />}
		</LexicalComposer>
	);
}

function FocusOnMount() {
	const [editor] = useLexicalComposerContext();
	useEffect(() => editor.focus(), [editor]);
	return null;
}

function useComposer({
	onSubmit,
	blocked,
	disabled,
	streaming,
	files,
	assist,
}: ChatInputProps) {
	const [editor] = useLexicalComposerContext();
	const [notice, flash] = useNotice();
	const history = assist?.history ?? NO_HISTORY;
	const { attachments, submit } = useAttachedSend({
		onSubmit,
		flash,
		files,
		streaming: streaming?.active === true,
		held: blocked,
	});
	const busy = disabled === true;
	const { text, empty, replace, send } = useDraft(
		submit,
		busy,
		attachments.items.length > 0,
	);
	const picker = useRef<HTMLInputElement>(null);
	const attach = useCallback(() => picker.current?.click(), []);
	const { over, zone } = useDropZone(
		attachments.add,
		busy || !attachments.enabled,
	);
	const search = usePromptSearch(history, replace);
	const step = useRecall(history);
	const menus = useMenus();
	const pick = usePick({
		replace,
		onCommand: assist?.onCommand,
		flash,
		search: search.setSearching,
		attach,
	});
	const stops = streaming?.active === true && empty;

	useKeys({
		disabled: busy,
		menuActive: () => menus.active.current,
		recall: (direction) => step(text, direction),
		replace,
		enter: stops ? streaming?.onStop : send,
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
		notice: noticeOf(over, notice),
		pickFiles: (picked: File[]) => {
			attachments.add(picked);
			editor.focus();
		},
		sendNow: () => send(),
	};
}

function Editor(props: ChatInputProps) {
	const { placeholder = "", streaming, assist, blocked } = props;
	const lisp = props.on?.lisp ?? true;
	const attach = props.on?.attach ?? true;
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
				items={c.attachments.items}
				onRemove={c.attachments.remove}
			/>
			<InputShell
				prompt={c.look.prompt}
				tone={c.look.tone}
				dim={c.busy}
				action={
					<>
						{attach && c.attachments.enabled && (
							<AttachAction onClick={c.attach} disabled={c.busy} />
						)}
						<SendAction
							streaming={streaming}
							empty={c.empty}
							disabled={c.busy}
							blocked={blocked}
							onSend={c.sendNow}
						/>
					</>
				}
			>
				<Field
					placeholder={hintOf(
						placeholder,
						lisp,
						assist?.onCommand !== undefined,
					)}
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
				files={assist?.mentions ?? []}
				host={c.menus.host}
				active={c.menus.mentionOpen}
			/>
			<LispPlugins
				on={lisp}
				symbols={assist?.symbols ?? NO_SYMBOLS}
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
