import { useCallback } from "react";
import { useAppearance } from "./appearance.tsx";
import { useChatStore } from "./chat.tsx";
import { useNewChat } from "./chats.ts";
import { useModelPicker } from "./model-picker.tsx";
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
	{ name: "/font", desc: "choose the font" },
	{ name: "/model", desc: "choose the model this workspace runs on" },
	{ name: "/panel", desc: "toggle the side panel", desktopOnly: true },
	{ name: "/sidebar", desc: "toggle the sidebar", desktopOnly: true },
	{ name: "/theme", desc: "choose the colour theme" },
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

function quietly(run: () => void) {
	return () => {
		run();
		return null;
	};
}

export function useCommandRunner() {
	const { toggleLeft, toggleRight, toggleChannel, shown } = useUI();
	const store = useChatStore();
	const newChat = useNewChat();
	const { openModelPicker } = useModelPicker();
	const { openThemePicker, openFontPicker } = useAppearance();

	return useCallback(
		async (name: string): Promise<string | null> => {
			const actions: Record<
				string,
				() => Promise<string | null> | string | null
			> = {
				"/clear": async () => {
					await newChat();
					return null;
				},
				"/copy": () => copyConversation(transcript(store.getState().messages)),
				"/sidebar": quietly(toggleLeft),
				"/panel": quietly(toggleRight),
				"/model": quietly(openModelPicker),
				"/theme": quietly(openThemePicker),
				"/font": quietly(openFontPicker),
				"/debug": () => {
					toggleChannel("model");
					return shown.model
						? "the model channel is hidden"
						: "the model channel is shown";
				},
			};
			return (await actions[name]?.()) ?? null;
		},
		[
			toggleLeft,
			toggleRight,
			toggleChannel,
			shown,
			newChat,
			store,
			openModelPicker,
			openThemePicker,
			openFontPicker,
		],
	);
}
