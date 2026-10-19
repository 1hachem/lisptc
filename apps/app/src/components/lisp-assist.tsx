import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
	LexicalTypeaheadMenuPlugin,
	MenuOption,
	type MenuTextMatch,
} from "@lexical/react/LexicalTypeaheadMenuPlugin";
import {
	type CallAt,
	insideForm,
	languageService,
	lispIn,
	type SymbolEntry,
	type SymbolTable,
	UNCLOSED,
} from "@repo/language-service";
import { toolkits } from "@repo/toolkit";
import { cn } from "@repo/ui";
import {
	$getRoot,
	$getSelection,
	$isElementNode,
	$isRangeSelection,
	ParagraphNode,
	type TextNode,
} from "lexical";
import {
	type ReactNode,
	type RefObject,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import { TextDocument } from "vscode-languageserver-textdocument";
import type {
	CompletionItem,
	Diagnostic,
	Position,
} from "vscode-languageserver-types";
import { $offsetIn } from "./lisp-highlight.ts";

const MAX_OPTIONS = 8;
const DIAGNOSE_MS = 300;
const PARAGRAPH_GAP = 2;
const WORD_BEFORE = /[^\s()'`",]+$/;

class CompletionOption extends MenuOption {
	readonly item: CompletionItem;
	constructor(item: CompletionItem) {
		super(item.label);
		this.item = item;
	}
}

function $caretOffset(): number | null {
	const selection = $getSelection();
	if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null;
	const top = selection.anchor.getNode().getTopLevelElement();
	let before = 0;
	for (const block of $getRoot().getChildren()) {
		if (top !== null && block.is(top)) {
			const inBlock =
				block instanceof ParagraphNode
					? $offsetIn(block, selection.anchor)
					: null;
			return inBlock === null ? null : before + inBlock;
		}
		before += block.getTextContentSize() + PARAGRAPH_GAP;
	}
	return $isElementNode(selection.anchor.getNode()) ? 0 : null;
}

function useLispDocument() {
	const [editor] = useLexicalComposerContext();
	const document = useRef(
		TextDocument.create("inmemory://chat-input", "lisptc", 0, ""),
	);
	return useCallback((): {
		document: TextDocument;
		position: Position | null;
	} => {
		const { text, offset } = editor.getEditorState().read(() => ({
			text: $getRoot().getTextContent(),
			offset: $caretOffset(),
		}));
		const lisp = lispIn(text);
		const standing = document.current;
		if (standing.getText() !== lisp)
			document.current = TextDocument.update(
				standing,
				[{ text: lisp }],
				standing.version + 1,
			);
		return {
			document: document.current,
			position: offset === null ? null : document.current.positionAt(offset),
		};
	}, [editor]);
}

function CallHint({ call }: { call: CallAt }) {
	const { entry, supplied, active } = call;
	const summary = entry.doc?.split("\n")[0];
	return (
		<div className="flex flex-col px-3 py-0.5">
			<span className="truncate">
				{entry.args?.length ? (
					<>
						<span className="text-fg">({entry.name}</span>
						{entry.args.map((arg) => (
							<span
								key={arg.name}
								className={cn(
									supplied.has(arg.name)
										? "text-dim"
										: arg.required
											? "text-yellow"
											: "text-dim",
									arg.name === active && "font-bold text-fg",
								)}
							>
								{` :${arg.name}`}
							</span>
						))}
						<span className="text-fg">)</span>
					</>
				) : (
					<span className="text-fg">{entry.signature ?? entry.name}</span>
				)}
			</span>
			{summary ? (
				<span className="truncate text-[12px] text-dim">{summary}</span>
			) : null}
		</div>
	);
}

function Problems({ diagnostics }: { diagnostics: Diagnostic[] }) {
	return diagnostics.map((d) => (
		<div
			key={`${d.range.start.line}:${d.message}`}
			className="truncate px-3 py-0.5 text-red"
		>
			{d.message}
		</div>
	));
}

function HoverDoc({ entry, at }: { entry: SymbolEntry; at: DOMRect }) {
	return createPortal(
		<div
			role="tooltip"
			style={{ left: at.left, bottom: window.innerHeight - at.top + 4 }}
			className="pointer-events-none fixed z-50 max-w-[480px] border border-bg2 bg-bg1 px-3 py-1 font-mono text-[12px]"
		>
			{entry.signature ? (
				<div className="text-fg">{entry.signature}</div>
			) : null}
			{entry.doc ? (
				<div className="whitespace-pre-wrap text-dim">{entry.doc}</div>
			) : null}
		</div>,
		document.body,
	);
}

function useHover(symbols: SymbolTable) {
	const [editor] = useLexicalComposerContext();
	const [hover, setHover] = useState<{
		entry: SymbolEntry;
		at: DOMRect;
	} | null>(null);
	const table = useRef(symbols);
	table.current = symbols;
	useEffect(
		() =>
			editor.registerRootListener((root, previous) => {
				const over = (event: MouseEvent) => {
					const target = event.target;
					if (!(target instanceof HTMLElement)) return;
					if (!target.className.startsWith("th-")) return setHover(null);
					const entry = table.current.get(target.textContent ?? "");
					if (entry?.signature === undefined && !entry?.doc)
						return setHover(null);
					setHover({ entry, at: target.getBoundingClientRect() });
				};
				const out = () => setHover(null);
				previous?.removeEventListener("mouseover", over);
				previous?.removeEventListener("mouseleave", out);
				root?.addEventListener("mouseover", over);
				root?.addEventListener("mouseleave", out);
			}),
		[editor],
	);
	return hover;
}

function useAssist(
	symbols: SymbolTable,
	snapshot: ReturnType<typeof useLispDocument>,
) {
	const [editor] = useLexicalComposerContext();
	const service = useMemo(
		() => languageService(symbols, { toolkits }),
		[symbols],
	);
	const [call, setCall] = useState<CallAt | undefined>();
	const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
	useEffect(() => {
		let timer: ReturnType<typeof setTimeout> | undefined;
		const refresh = () => {
			const { document, position } = snapshot();
			setCall(
				position === null ? undefined : service.callAt(document, position),
			);
			clearTimeout(timer);
			timer = setTimeout(
				() =>
					setDiagnostics(
						service.diagnostics(document).filter((d) => d.code !== UNCLOSED),
					),
				DIAGNOSE_MS,
			);
		};
		refresh();
		const off = editor.registerUpdateListener(refresh);
		return () => {
			off();
			clearTimeout(timer);
		};
	}, [editor, service, snapshot]);
	return { service, call, diagnostics };
}

export function LispAssistPlugin({
	symbols,
	host,
	active,
}: {
	symbols: SymbolTable;
	host: RefObject<HTMLDivElement | null>;
	active: RefObject<boolean>;
}) {
	const [editor] = useLexicalComposerContext();
	const snapshot = useLispDocument();
	const { service, call, diagnostics } = useAssist(symbols, snapshot);
	const hover = useHover(symbols);
	const [query, setQuery] = useState<string | null>(null);
	const [open, setOpen] = useState(false);

	const options = useMemo(() => {
		if (query === null) return [];
		const { document, position } = snapshot();
		if (position === null) return [];
		return service
			.completions(document, position)
			.filter((item) => item.label.startsWith(query) && item.label !== query)
			.slice(0, MAX_OPTIONS)
			.map((item) => new CompletionOption(item));
	}, [query, service, snapshot]);

	useEffect(() => {
		active.current = open && options.length > 0;
	}, [active, open, options]);

	const triggerFn = useCallback(
		(typed: string): MenuTextMatch | null => {
			const word = WORD_BEFORE.exec(typed)?.[0];
			if (word === undefined) return null;
			const { document, position } = snapshot();
			if (position === null || !insideForm(document, position)) return null;
			return {
				leadOffset: typed.length - word.length,
				matchingString: word,
				replaceableString: word,
			};
		},
		[snapshot],
	);

	const onSelectOption = useCallback(
		(
			option: CompletionOption,
			node: TextNode | null,
			closeMenu: () => void,
		) => {
			editor.update(() => {
				node?.setTextContent(option.item.label).select();
				closeMenu();
			});
		},
		[editor],
	);

	const shown = open && options.length > 0;
	const strip: ReactNode =
		!shown && (call !== undefined || diagnostics.length > 0) ? (
			<div className="flex w-full flex-col border-b border-bg2 bg-bg1 py-0.5 font-mono text-[13px]">
				{call ? <CallHint call={call} /> : null}
				<Problems diagnostics={diagnostics} />
			</div>
		) : null;

	return (
		<>
			{host.current && strip ? createPortal(strip, host.current) : null}
			{hover ? <HoverDoc entry={hover.entry} at={hover.at} /> : null}
			<LexicalTypeaheadMenuPlugin<CompletionOption>
				options={options}
				triggerFn={triggerFn}
				onQueryChange={setQuery}
				onSelectOption={onSelectOption}
				onOpen={() => setOpen(true)}
				onClose={() => setOpen(false)}
				menuRenderFn={(
					_anchor,
					{ selectedIndex, selectOptionAndCleanUp, setHighlightedIndex },
				) =>
					host.current && options.length > 0
						? createPortal(
								<div className="flex w-full flex-col gap-px border-b border-bg2 bg-bg1 py-1 font-mono text-[13px]">
									{options.map((option, i) => (
										<button
											type="button"
											key={option.key}
											ref={(element) => option.setRefElement(element)}
											onMouseEnter={() => setHighlightedIndex(i)}
											onMouseDown={(event) => event.preventDefault()}
											onClick={() => selectOptionAndCleanUp(option)}
											className={cn(
												"flex items-baseline gap-2.5 px-3 py-0.5 text-left",
												i === selectedIndex ? "bg-bg2" : "hover:brightness-125",
											)}
										>
											<span className="flex-none whitespace-nowrap text-fg">
												{option.item.label}
											</span>
											<span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[12px] text-dim">
												{option.item.detail}
											</span>
										</button>
									))}
								</div>,
								host.current,
							)
						: null
				}
			/>
		</>
	);
}
