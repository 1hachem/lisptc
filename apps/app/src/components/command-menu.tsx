import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
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
import { TypeaheadMenu } from "./typeahead-menu.tsx";

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
		<TypeaheadMenu<CommandOption>
			options={options}
			host={host}
			rowOf={({ command }) => ({
				label: command.name,
				detail: command.desc,
				hint: command.hint,
			})}
			triggerFn={triggerFn}
			onQueryChange={setQuery}
			onSelectOption={onSelectOption}
			onOpenChange={setOpen}
		/>
	);
}
