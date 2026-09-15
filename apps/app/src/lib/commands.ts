import { useCallback } from "react";
import { useChatSession } from "./chat.tsx";
import { transcript } from "./transcript.ts";
import { useUI } from "./ui.tsx";

export interface Command {
	name: string;
	desc: string;
	hint?: string;
	desktopOnly?: boolean;
	takesArgument?: boolean;
}

export const commands: Command[] = [
	{ name: "/clear", desc: "start a fresh session" },
	{ name: "/copy", desc: "copy the conversation to the clipboard" },
	{ name: "/debug", desc: "show what each step sent back to the model" },
	{ name: "/panel", desc: "toggle the side panel", desktopOnly: true },
	{ name: "/sidebar", desc: "toggle the sidebar", desktopOnly: true },
];

async function copyConversation(text: string): Promise<string> {
	if (!text) return "nothing to copy";
	try {
		await navigator.clipboard.writeText(text);
		return "conversation copied";
	} catch {
		return "the clipboard is not available";
	}
}

export function useCommandRunner() {
	const { toggleLeft, toggleRight, toggleChannel, shown } = useUI();
	const { clear, messages } = useChatSession();

	return useCallback(
		async (name: string): Promise<string | null> => {
			switch (name) {
				case "/clear":
					clear();
					return null;
				case "/copy":
					return await copyConversation(transcript(messages));
				case "/sidebar":
					toggleLeft();
					return null;
				case "/panel":
					toggleRight();
					return null;
				case "/debug":
					toggleChannel("model");
					return shown.model
						? "the model channel is hidden"
						: "the model channel is shown";
				default:
					return null;
			}
		},
		[toggleLeft, toggleRight, toggleChannel, shown, clear, messages],
	);
}
