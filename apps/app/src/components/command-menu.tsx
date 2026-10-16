import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
	LexicalTypeaheadMenuPlugin,
	MenuOption,
	type MenuTextMatch,
} from "@lexical/react/LexicalTypeaheadMenuPlugin";
import { cn, useIsMobile } from "@repo/ui";
import { $getRoot } from "lexical";
import {
	type RefObject,
	useCallback,
	useEffect,
	useMemo,
	useState,
} from "react";
import { createPortal } from "react-dom";
import { type Command, commands, matchesCommand } from "../lib/commands.ts";

const COMMAND_QUERY = /^\/(\S*)$/;

class CommandOption extends MenuOption {
	readonly command: Command;
	constructor(command: Command) {
		super(command.name);
		this.command = command;
	}
}

export function CommandMenuPlugin({
	onPick,
	host,
	active,
}: {
	onPick: (command: Command) => void;
	host: RefObject<HTMLDivElement | null>;
	active: RefObject<boolean>;
}) {
	const [editor] = useLexicalComposerContext();
	const [query, setQuery] = useState<string | null>(null);
	const [open, setOpen] = useState(false);
	const isMobile = useIsMobile();

	const options = useMemo(
		() =>
			commands
				.filter((c) => !(isMobile && c.desktopOnly))
				.filter((c) => matchesCommand(c, query ?? ""))
				.map((c) => new CommandOption(c)),
		[query, isMobile],
	);

	useEffect(() => {
		active.current = open && options.length > 0;
	}, [active, open, options]);

	const triggerFn = useCallback(
		(typed: string): MenuTextMatch | null => {
			const match = COMMAND_QUERY.exec(typed);
			const whole = editor
				.getEditorState()
				.read(() => $getRoot().getTextContent());
			if (!match || whole !== typed) return null;
			return {
				leadOffset: 0,
				matchingString: match[1] ?? "",
				replaceableString: match[0],
			};
		},
		[editor],
	);

	const onSelectOption = useCallback(
		(option: CommandOption, _node: unknown, closeMenu: () => void) => {
			closeMenu();
			onPick(option.command);
		},
		[onPick],
	);

	return (
		<LexicalTypeaheadMenuPlugin<CommandOption>
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
											{option.command.name}
										</span>
										<span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[12px] text-dim">
											{option.command.desc}
										</span>
										{option.command.hint && (
											<span className="flex-none text-[10.5px] text-dim">
												{option.command.hint}
											</span>
										)}
									</button>
								))}
							</div>,
							host.current,
						)
					: null
			}
		/>
	);
}
