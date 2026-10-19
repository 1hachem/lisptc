import {
	LexicalTypeaheadMenuPlugin,
	type MenuOption,
} from "@lexical/react/LexicalTypeaheadMenuPlugin";
import { cn } from "@repo/ui";
import {
	type ReactNode,
	type RefObject,
	useLayoutEffect,
	useState,
} from "react";
import { createPortal } from "react-dom";

export type PluginProps<T extends MenuOption> = Parameters<
	typeof LexicalTypeaheadMenuPlugin<T>
>[0];

export interface MenuRow {
	label: ReactNode;
	detail?: string;
	hint?: string;
}

function Row({
	row,
	selected,
	onPoint,
	onPick,
	refTo,
}: {
	row: MenuRow;
	selected: boolean;
	onPoint: () => void;
	onPick: () => void;
	refTo: (element: HTMLButtonElement | null) => void;
}) {
	return (
		<button
			type="button"
			role="option"
			aria-selected={selected}
			ref={(element) => {
				refTo(element);
				if (selected) element?.scrollIntoView?.({ block: "nearest" });
			}}
			onMouseEnter={onPoint}
			onMouseDown={(event) => event.preventDefault()}
			onClick={onPick}
			className={cn(
				"flex h-row flex-none items-center gap-2.5 px-3 text-left",
				selected ? "bg-bg2" : "hover:brightness-125",
			)}
		>
			<span className="flex-none whitespace-nowrap text-fg">{row.label}</span>
			<span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[12px] text-dim">
				{row.detail}
			</span>
			{row.hint && (
				<span className="flex-none text-[10.5px] text-dim">{row.hint}</span>
			)}
		</button>
	);
}

const BESIDE_GAP = 6;

interface Place {
	top: number;
	left?: number;
	right?: number;
}

function placeBeside(row: DOMRect, menu: DOMRect, width: number): Place {
	const roomRight = window.innerWidth - menu.right - BESIDE_GAP;
	return roomRight >= width
		? { top: row.top, left: menu.right + BESIDE_GAP }
		: { top: row.top, right: window.innerWidth - menu.left + BESIDE_GAP };
}

const samePlace = (a: Place | null, b: Place) =>
	a?.top === b.top && a.left === b.left && a.right === b.right;

function Beside({
	row,
	children,
}: {
	row: RefObject<HTMLElement | null>;
	children: ReactNode;
}) {
	const [tip, setTip] = useState<HTMLDivElement | null>(null);
	const [place, setPlace] = useState<Place | null>(null);
	useLayoutEffect(() => {
		const element = row.current;
		const menu = element?.closest("[role=listbox]");
		if (!element || !menu || !tip) return;
		const next = placeBeside(
			element.getBoundingClientRect(),
			menu.getBoundingClientRect(),
			tip.offsetWidth,
		);
		setPlace((standing) => (samePlace(standing, next) ? standing : next));
	});
	return createPortal(
		<div
			ref={setTip}
			role="tooltip"
			style={place ?? { visibility: "hidden" }}
			className="pointer-events-none fixed z-50 max-w-dialog-sm border border-bg2 bg-bg1 font-mono"
		>
			{children}
		</div>,
		document.body,
	);
}

export function TypeaheadMenu<T extends MenuOption>({
	options,
	host,
	rowOf,
	asideOf,
	triggerFn,
	onQueryChange,
	onSelectOption,
	onOpenChange,
}: Pick<
	PluginProps<T>,
	"options" | "triggerFn" | "onQueryChange" | "onSelectOption"
> & {
	host: RefObject<HTMLDivElement | null>;
	rowOf: (option: T) => MenuRow;
	asideOf?: (option: T) => ReactNode;
	onOpenChange: (open: boolean) => void;
}) {
	return (
		<LexicalTypeaheadMenuPlugin<T>
			options={options}
			triggerFn={triggerFn}
			onQueryChange={onQueryChange}
			onSelectOption={onSelectOption}
			onOpen={() => onOpenChange(true)}
			onClose={() => onOpenChange(false)}
			anchorClassName="hidden!"
			menuRenderFn={(
				_anchor,
				{ selectedIndex, selectOptionAndCleanUp, setHighlightedIndex },
			) => {
				if (!host.current || options.length === 0) return null;
				const selected =
					selectedIndex === null ? undefined : options[selectedIndex];
				return createPortal(
					<div className="flex w-full flex-col border-b border-bg2 bg-bg1 font-mono text-[13px]">
						<div
							role="listbox"
							className="flex max-h-menu flex-col overflow-y-auto py-1"
						>
							{options.map((option, i) => (
								<Row
									key={option.key}
									row={rowOf(option)}
									selected={i === selectedIndex}
									onPoint={() => setHighlightedIndex(i)}
									onPick={() => selectOptionAndCleanUp(option)}
									refTo={(element) => option.setRefElement(element)}
								/>
							))}
						</div>
						{selected?.ref && asideOf ? (
							<Beside row={selected.ref}>{asideOf(selected)}</Beside>
						) : null}
					</div>,
					host.current,
				);
			}}
		/>
	);
}
