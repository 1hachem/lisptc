import type {
	MenuOption,
	MenuRenderFn,
} from "@lexical/react/LexicalTypeaheadMenuPlugin";
import { cn } from "@repo/ui";
import { anchorOf } from "@repo/ui-catalog";
import type { ReactNode, ReactPortal, RefObject } from "react";
import { createPortal } from "react-dom";

export function typeaheadList<O extends MenuOption>(
	host: RefObject<HTMLDivElement | null>,
	options: O[],
	{
		selectedIndex,
		selectOptionAndCleanUp,
		setHighlightedIndex,
	}: Parameters<MenuRenderFn<O>>[1],
	row: (option: O) => ReactNode,
	align: "baseline" | "center" = "baseline",
): ReactPortal | null {
	if (!host.current || options.length === 0) return null;
	return createPortal(
		<div
			{...anchorOf("composer/menu")}
			className="flex w-full flex-col gap-px border-b border-bg2 bg-bg1 py-1 font-mono text-[13px]"
		>
			{options.map((option, i) => (
				<button
					type="button"
					key={option.key}
					ref={(element) => option.setRefElement(element)}
					onMouseEnter={() => setHighlightedIndex(i)}
					onMouseDown={(event) => event.preventDefault()}
					onClick={() => selectOptionAndCleanUp(option)}
					className={cn(
						"flex gap-2.5 px-3 py-0.5 text-left",
						align === "center" ? "items-center" : "items-baseline",
						i === selectedIndex ? "bg-bg2" : "hover:brightness-125",
					)}
				>
					{row(option)}
				</button>
			))}
		</div>,
		host.current,
	);
}
