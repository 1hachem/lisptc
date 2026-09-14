import { ClearEditorPlugin } from "@lexical/react/LexicalClearEditorPlugin";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { PlainTextPlugin } from "@lexical/react/LexicalPlainTextPlugin";
import {
	LexicalTypeaheadMenuPlugin,
	MenuOption,
	useBasicTypeaheadTriggerMatch,
} from "@lexical/react/LexicalTypeaheadMenuPlugin";
import { cn, useIsMobile } from "@repo/ui";
import {
	$createTextNode,
	$getRoot,
	CLEAR_EDITOR_COMMAND,
	COMMAND_PRIORITY_LOW,
	KEY_ENTER_COMMAND,
	type TextNode,
} from "lexical";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { type Command, commands } from "../lib/commands.ts";
import { InputAction, InputShell } from "./input-shell.tsx";
import { LispEditor } from "./lisp-editor.tsx";

export interface ChatInputProps {
	placeholder?: string;
	onSubmit: (text: string) => void;
	onLisp: (code: string) => void;
	onCommand?: (name: string) => void;
	isStreaming?: boolean;
	onStop?: () => void;
	disabled?: boolean;
}

const LISP_PREFIX = "!";

class CommandOption extends MenuOption {
	command: Command;
	constructor(command: Command) {
		super(command.name);
		this.command = command;
	}
}

export function ChatInput({
	placeholder = "",
	onSubmit,
	onLisp,
	onCommand,
	isStreaming,
	onStop,
	disabled,
}: ChatInputProps) {
	const [lisp, setLisp] = useState<string | null>(null);

	return (
		<div className="mx-auto flex w-full max-w-[680px] flex-col font-mono text-[13px] leading-[1.7]">
			{lisp === null ? (
				<LexicalComposer
					initialConfig={{
						namespace: "chat-input",
						theme: {},
						nodes: [],
						onError: (error) => {
							throw error;
						},
					}}
				>
					<Editor
						placeholder={placeholder}
						onSubmit={onSubmit}
						onLisp={onLisp}
						onEnterLisp={setLisp}
						onCommand={onCommand}
						isStreaming={isStreaming}
						onStop={onStop}
						disabled={disabled}
					/>
				</LexicalComposer>
			) : (
				<LispEditor
					initial={lisp}
					onRun={onLisp}
					onExit={() => setLisp(null)}
					isStreaming={isStreaming}
					onStop={onStop}
				/>
			)}
		</div>
	);
}

function Editor({
	placeholder = "",
	onSubmit,
	onEnterLisp,
	onCommand,
	isStreaming,
	onStop,
	disabled,
}: ChatInputProps & { onEnterLisp: (code: string) => void }) {
	const [editor] = useLexicalComposerContext();
	const menuOpen = useRef(false);
	const menuHost = useRef<HTMLDivElement>(null);

	useEffect(() => {
		editor.setEditable(!disabled);
	}, [editor, disabled]);

	useEffect(() => {
		if (disabled) return;
		return editor.registerUpdateListener(({ editorState }) => {
			const text = editorState.read(() => $getRoot().getTextContent());
			if (!text.startsWith(LISP_PREFIX)) return;
			queueMicrotask(() => {
				editor.dispatchCommand(CLEAR_EDITOR_COMMAND, undefined);
				onEnterLisp(text.slice(LISP_PREFIX.length));
			});
		});
	}, [editor, onEnterLisp, disabled]);

	const runText = useCallback(() => {
		if (disabled) return;
		const text = editor
			.getEditorState()
			.read(() => $getRoot().getTextContent())
			.trim();
		if (!text) return;
		onSubmit(text);
		editor.dispatchCommand(CLEAR_EDITOR_COMMAND, undefined);
	}, [editor, onSubmit, disabled]);

	const runCommand = useCallback(
		(name: string) => {
			onCommand?.(name);
			editor.dispatchCommand(CLEAR_EDITOR_COMMAND, undefined);
		},
		[editor, onCommand],
	);

	return (
		<>
			<div ref={menuHost} />
			<InputShell
				prompt={disabled ? "⋯" : "›"}
				tone={disabled ? "text-dim" : "text-green"}
				dim={disabled}
				action={
					isStreaming ? (
						<InputAction
							label="stop"
							glyph="■"
							tone="text-red hover:brightness-125"
							onClick={onStop}
						/>
					) : (
						<InputAction
							label="send"
							glyph="⏎"
							tone="text-green hover:brightness-125"
							onClick={runText}
							disabled={disabled}
						/>
					)
				}
			>
				<PlainTextPlugin
					contentEditable={
						<ContentEditable
							aria-placeholder={placeholder}
							placeholder={
								<div className="pointer-events-none absolute inset-0 truncate py-1 text-dim">
									{placeholder}
								</div>
							}
							className={cn(
								"max-h-40 min-h-0 overflow-y-auto py-1 outline-none",
								disabled
									? "cursor-not-allowed text-dim"
									: "text-yellow caret-yellow",
							)}
						/>
					}
					ErrorBoundary={LexicalErrorBoundary}
				/>
			</InputShell>

			<HistoryPlugin />
			<ClearEditorPlugin />
			<CommandMenuPlugin
				onPick={runCommand}
				menuHost={menuHost}
				onOpenChange={(open) => {
					menuOpen.current = open;
				}}
			/>
			<EnterSubmitPlugin
				onEnter={isStreaming ? (onStop ?? (() => {})) : runText}
				disabled={disabled}
				isMenuOpen={() => menuOpen.current}
			/>
		</>
	);
}

function EnterSubmitPlugin({
	onEnter,
	isMenuOpen,
	disabled,
}: {
	onEnter: () => void;
	isMenuOpen: () => boolean;
	disabled?: boolean;
}) {
	const [editor] = useLexicalComposerContext();
	useEffect(
		() =>
			editor.registerCommand(
				KEY_ENTER_COMMAND,
				(event) => {
					if (disabled) {
						event?.preventDefault();
						return true;
					}
					if (isMenuOpen() || event?.shiftKey) return false;
					event?.preventDefault();
					onEnter();
					return true;
				},
				COMMAND_PRIORITY_LOW,
			),
		[editor, onEnter, isMenuOpen, disabled],
	);
	return null;
}

function CommandMenuPlugin({
	onPick,
	onOpenChange,
	menuHost,
}: {
	onPick: (name: string) => void;
	onOpenChange: (open: boolean) => void;
	menuHost: React.RefObject<HTMLDivElement | null>;
}) {
	const [editor] = useLexicalComposerContext();
	const [query, setQuery] = useState<string | null>(null);
	const isMobile = useIsMobile();
	const triggerFn = useBasicTypeaheadTriggerMatch("/", { minLength: 0 });

	const options = useMemo(() => {
		const q = (query ?? "").toLowerCase();
		return commands
			.filter((c) => !(isMobile && c.desktopOnly))
			.filter((c) => c.name.slice(1).startsWith(q))
			.map((c) => new CommandOption(c));
	}, [query, isMobile]);

	const onSelectOption = useCallback(
		(
			option: CommandOption,
			nodeToRemove: TextNode | null,
			closeMenu: () => void,
		) => {
			if (option.command.takesArgument) {
				editor.update(() => {
					const typed = $createTextNode(`${option.command.name} `);
					if (nodeToRemove) nodeToRemove.replace(typed);
					else $getRoot().getLastChild()?.insertAfter(typed);
					typed.selectEnd();
				});
				closeMenu();
				return;
			}
			editor.update(() => nodeToRemove?.remove());
			closeMenu();
			onPick(option.command.name);
		},
		[editor, onPick],
	);

	return (
		<LexicalTypeaheadMenuPlugin<CommandOption>
			options={options}
			triggerFn={triggerFn}
			onQueryChange={setQuery}
			onSelectOption={onSelectOption}
			onOpen={() => onOpenChange(true)}
			onClose={() => onOpenChange(false)}
			menuRenderFn={(
				_anchorRef,
				{ selectedIndex, selectOptionAndCleanUp, setHighlightedIndex },
			) =>
				menuHost.current && options.length
					? createPortal(
							<div className="flex w-full flex-col gap-px border-b border-bg2 bg-bg1 py-1 font-mono text-[13px]">
								{options.map((opt, i) => (
									<button
										type="button"
										key={opt.key}
										ref={(el) => opt.setRefElement(el)}
										onMouseEnter={() => setHighlightedIndex(i)}
										onClick={() => {
											setHighlightedIndex(i);
											selectOptionAndCleanUp(opt);
										}}
										className={cn(
											"flex items-baseline gap-2.5 px-3 py-0.5 text-left",
											i === selectedIndex ? "bg-bg2" : "hover:brightness-125",
										)}
									>
										<span className="flex-none whitespace-nowrap text-fg">
											{opt.command.name}
										</span>
										<span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[12px] text-dim">
											{opt.command.desc}
										</span>
										{opt.command.hint && (
											<span className="flex-none text-[10.5px] text-dim">
												{opt.command.hint}
											</span>
										)}
									</button>
								))}
							</div>,
							menuHost.current,
						)
					: null
			}
		/>
	);
}
