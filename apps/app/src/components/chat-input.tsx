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
import { cn } from "@repo/ui";
import {
	$getRoot,
	CLEAR_EDITOR_COMMAND,
	COMMAND_PRIORITY_LOW,
	KEY_ENTER_COMMAND,
	type TextNode,
} from "lexical";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { type Command, commands } from "../lib/commands.ts";

export interface ChatInputProps {
	placeholder?: string;
	onSubmit: (text: string) => void;
	/** run when a `/` command is picked */
	onCommand?: (name: string) => void;
}

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
	onCommand,
}: ChatInputProps) {
	return (
		<div className="mx-auto flex w-full max-w-[680px] flex-col font-mono text-[13px] leading-[1.7]">
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
					onCommand={onCommand}
				/>
			</LexicalComposer>
		</div>
	);
}

function Editor({ placeholder = "", onSubmit, onCommand }: ChatInputProps) {
	const [editor] = useLexicalComposerContext();
	const menuOpen = useRef(false);
	const menuHost = useRef<HTMLDivElement>(null);

	const runText = useCallback(() => {
		const text = editor
			.getEditorState()
			.read(() => $getRoot().getTextContent())
			.trim();
		if (!text) return;
		onSubmit(text);
		editor.dispatchCommand(CLEAR_EDITOR_COMMAND, undefined);
	}, [editor, onSubmit]);

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
			<div className="flex w-full items-end gap-2.5 border-b border-bg2 bg-bg1 px-3 py-1">
				<span className="flex-none self-start py-1 text-green">›</span>
				<div className="relative min-w-0 flex-1">
					<PlainTextPlugin
						contentEditable={
							<ContentEditable
								aria-placeholder={placeholder}
								placeholder={
									<div className="pointer-events-none absolute inset-0 py-1 text-dim">
										{placeholder}
									</div>
								}
								className="max-h-40 min-h-0 overflow-y-auto py-1 text-yellow caret-yellow outline-none"
							/>
						}
						ErrorBoundary={LexicalErrorBoundary}
					/>
				</div>
				<button
					type="button"
					onClick={runText}
					className="flex h-auto flex-none items-center gap-[7px] self-center rounded-none bg-bg2 px-[9px] py-px text-[11.5px] text-green hover:brightness-125"
				>
					<span>send</span>
					<span className="text-dim">⏎</span>
				</button>
			</div>

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
				onEnter={runText}
				isMenuOpen={() => menuOpen.current}
			/>
		</>
	);
}

/** Submits on Enter (Shift+Enter inserts a newline); yields to the command menu. */
function EnterSubmitPlugin({
	onEnter,
	isMenuOpen,
}: {
	onEnter: () => void;
	isMenuOpen: () => boolean;
}) {
	const [editor] = useLexicalComposerContext();
	useEffect(
		() =>
			editor.registerCommand(
				KEY_ENTER_COMMAND,
				(event) => {
					if (isMenuOpen() || event?.shiftKey) return false;
					event?.preventDefault();
					onEnter();
					return true;
				},
				COMMAND_PRIORITY_LOW,
			),
		[editor, onEnter, isMenuOpen],
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
	const triggerFn = useBasicTypeaheadTriggerMatch("/", { minLength: 0 });

	const options = useMemo(() => {
		const q = (query ?? "").toLowerCase();
		return commands
			.filter((c) => c.name.slice(1).startsWith(q))
			.map((c) => new CommandOption(c));
	}, [query]);

	const onSelectOption = useCallback(
		(
			option: CommandOption,
			nodeToRemove: TextNode | null,
			closeMenu: () => void,
		) => {
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
