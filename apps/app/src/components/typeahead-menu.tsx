import {
	LexicalTypeaheadMenuPlugin,
	type MenuOption,
} from "@lexical/react/LexicalTypeaheadMenuPlugin";
import { cn } from "@repo/ui";
import type { RefObject } from "react";
import { createPortal } from "react-dom";

export type PluginProps<T extends MenuOption> = Parameters<
	typeof LexicalTypeaheadMenuPlugin<T>
>[0];

export interface MenuRow {
	label: string;
	detail?: string;
	hint?: string;
}

export function TypeaheadMenu<T extends MenuOption>({
	options,
	host,
	rowOf,
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
			menuRenderFn={(
				_anchor,
				{ selectedIndex, selectOptionAndCleanUp, setHighlightedIndex },
			) =>
				host.current && options.length > 0
					? createPortal(
							<div className="flex w-full flex-col gap-px border-b border-bg2 bg-bg1 py-1 font-mono text-[13px]">
								{options.map((option, i) => {
									const row = rowOf(option);
									return (
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
												{row.label}
											</span>
											<span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[12px] text-dim">
												{row.detail}
											</span>
											{row.hint && (
												<span className="flex-none text-[10.5px] text-dim">
													{row.hint}
												</span>
											)}
										</button>
									);
								})}
							</div>,
							host.current,
						)
					: null
			}
		/>
	);
}
