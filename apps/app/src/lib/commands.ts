import { useCallback } from "react";
import { clearMessages } from "./chat.ts";
import { useUI } from "./ui.tsx";

export interface Command {
	name: string;
	desc: string;
	hint?: string;
	/** hidden on phone-sized screens (e.g. sidebar toggles) */
	desktopOnly?: boolean;
}

export const commands: Command[] = [
	{ name: "/clear", desc: "start a fresh session" },
	{ name: "/panel", desc: "toggle the side panel", desktopOnly: true },
	{ name: "/sidebar", desc: "toggle the sidebar", desktopOnly: true },
];

/** Runs a `/` command picked from the input menu. */
export function useCommandRunner() {
	const { toggleLeft, toggleRight } = useUI();

	return useCallback(
		(name: string) => {
			switch (name) {
				case "/clear":
					clearMessages();
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
		[toggleLeft, toggleRight],
	);
}
