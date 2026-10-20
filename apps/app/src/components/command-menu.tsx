import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
	LexicalTypeaheadMenuPlugin,
	MenuOption,
	type MenuTextMatch,
} from "@lexical/react/LexicalTypeaheadMenuPlugin";
import { useIsMobile } from "@repo/ui";
import { $getRoot } from "lexical";
import {
	type RefObject,
	useCallback,
	useEffect,
	useMemo,
	useState,
} from "react";
import { type Command, commands, matchesCommand } from "../lib/commands.ts";
import { typeaheadList } from "./typeahead-list.tsx";

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
			anchorClassName="hidden!"
			menuRenderFn={(_anchor, state) =>
				typeaheadList(host, options, state, (option) => (
					<>
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
					</>
				))
			}
		/>
	);
}
