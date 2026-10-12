import { cn, useIsMobile } from "@repo/ui";
import { type KeyboardEvent, useMemo, useState } from "react";
import { type Command, commands } from "../lib/commands.ts";

const COMMAND_QUERY = /^\/(\S*)$/;

export interface CommandMenuState {
	options: Command[];
	selected: number;
	select: (index: number) => void;
	handleKey: (event: KeyboardEvent<HTMLTextAreaElement>) => boolean;
}

function matching(query: string, isMobile: boolean): Command[] {
	const typed = query.toLowerCase();
	return commands
		.filter((c) => !(isMobile && c.desktopOnly))
		.filter((c) => c.name.slice(1).startsWith(typed));
}

export function useCommandMenu(
	text: string,
	pick: (command: Command) => void,
): CommandMenuState {
	const [chosen, setChosen] = useState(0);
	const [dismissed, setDismissed] = useState<string | null>(null);
	const isMobile = useIsMobile();
	const query = COMMAND_QUERY.exec(text)?.[1];
	const options = useMemo(
		() =>
			query === undefined || dismissed === text
				? []
				: matching(query, isMobile),
		[query, dismissed, text, isMobile],
	);
	const selected = Math.min(chosen, Math.max(options.length - 1, 0));

	const moves: Record<string, () => void> = {
		ArrowDown: () => setChosen((selected + 1) % options.length),
		ArrowUp: () => setChosen((selected - 1 + options.length) % options.length),
		Escape: () => setDismissed(text),
		Tab: () => pick(options[selected] as Command),
		Enter: () => pick(options[selected] as Command),
	};

	const handleKey = (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
		const move = moves[event.key];
		if (options.length === 0 || move === undefined || event.shiftKey)
			return false;
		event.preventDefault();
		move();
		return true;
	};

	return { options, selected, select: setChosen, handleKey };
}

export function CommandMenu({
	menu,
	onPick,
}: {
	menu: CommandMenuState;
	onPick: (command: Command) => void;
}) {
	if (menu.options.length === 0) return null;
	return (
		<div className="flex w-full flex-col gap-px border-b border-bg2 bg-bg1 py-1 font-mono text-[13px]">
			{menu.options.map((command, i) => (
				<button
					type="button"
					key={command.name}
					onMouseEnter={() => menu.select(i)}
					onMouseDown={(event) => event.preventDefault()}
					onClick={() => onPick(command)}
					className={cn(
						"flex items-baseline gap-2.5 px-3 py-0.5 text-left",
						i === menu.selected ? "bg-bg2" : "hover:brightness-125",
					)}
				>
					<span className="flex-none whitespace-nowrap text-fg">
						{command.name}
					</span>
					<span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[12px] text-dim">
						{command.desc}
					</span>
					{command.hint && (
						<span className="flex-none text-[10.5px] text-dim">
							{command.hint}
						</span>
					)}
				</button>
			))}
		</div>
	);
}
