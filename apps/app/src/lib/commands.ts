import { useCallback } from "react";
import { useChatSession } from "./chat.tsx";
import { useUI } from "./ui.tsx";

export interface Command {
	name: string;
	desc: string;
	hint?: string;
	/** hidden on phone-sized screens (e.g. sidebar toggles) */
	desktopOnly?: boolean;
	/**
	 * The command is a prefix, not an action: picking it types the name into the
	 * composer and waits for the rest of the line instead of running immediately.
	 */
	takesArgument?: boolean;
}

export const commands: Command[] = [
	{
		name: "/note",
		desc: "comment on this conversation",
		hint: "#tags",
		takesArgument: true,
	},
	{ name: "/clear", desc: "start a fresh session" },
	{ name: "/panel", desc: "toggle the side panel", desktopOnly: true },
	{ name: "/sidebar", desc: "toggle the sidebar", desktopOnly: true },
];

/** Runs a `/` command picked from the input menu. */
export function useCommandRunner() {
	const { toggleLeft, toggleRight } = useUI();
	const { clear } = useChatSession();

	return useCallback(
		(name: string) => {
			switch (name) {
				case "/clear":
					clear();
					break;
				case "/sidebar":
					toggleLeft();
					break;
				case "/panel":
					toggleRight();
					break;
				default:
					break;
			}
		},
		[toggleLeft, toggleRight, clear],
	);
}
