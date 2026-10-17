import { themes } from "@repo/ui";
import { useCallback } from "react";
import { useAppearance } from "./appearance.tsx";
import { useChatStore } from "./chat.tsx";
import { useNewChat } from "./chats.ts";
import { useModelPicker } from "./model-picker.tsx";
import { darkVariant } from "./theme-uses.ts";
import { transcript } from "./transcript.ts";
import { useUI } from "./ui.tsx";

export interface Command {
	name: string;
	desc: string;
	hint?: string;
	desktopOnly?: boolean;
	takesArgument?: boolean;
	aliases?: string[];
}

export const commands: Command[] = [
	{ name: "/copy", desc: "copy the conversation to the clipboard" },
	{ name: "/dark", desc: "switch to the dark variant of the theme" },
	{ name: "/debug", desc: "show what each step sent back to the model" },
	{ name: "/font", desc: "choose the font" },
	{ name: "/model", desc: "choose the model this workspace runs on" },
	{ name: "/new", desc: "start a fresh session", aliases: ["/clear"] },
	{
		name: "/preferences",
		desc: "toggle the preferences panel",
		desktopOnly: true,
		aliases: ["/panel", "/right"],
	},
	{ name: "/prompt", desc: "search the prompts sent in this workspace" },
	{
		name: "/sidebar",
		desc: "toggle the sidebar",
		desktopOnly: true,
		aliases: ["/left"],
	},
	{ name: "/theme", desc: "choose the colour theme" },
];

export function matchesCommand(command: Command, typed: string): boolean {
	const query = typed.toLowerCase();
	return [command.name, ...(command.aliases ?? [])].some((name) =>
		name.slice(1).startsWith(query),
	);
}

export function canonicalCommand(typed: string): string {
	const name = typed.toLowerCase();
	return (
		commands.find(
			(command) =>
				command.name === name || command.aliases?.includes(name) === true,
		)?.name ?? name
	);
}

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
	const { theme, chooseTheme, openThemePicker, openFontPicker } =
		useAppearance();

	return useCallback(
		async (name: string): Promise<string | null> => {
			const actions: Record<
				string,
				() => Promise<string | null> | string | null
			> = {
				"/new": async () => {
					await newChat();
					return null;
				},
				"/copy": () => copyConversation(transcript(store.getState().messages)),
				"/sidebar": quietly(toggleLeft),
				"/preferences": quietly(toggleRight),
				"/model": quietly(openModelPicker),
				"/theme": quietly(openThemePicker),
				"/font": quietly(openFontPicker),
				"/dark": () => {
					const dark = darkVariant(themes, theme);
					if (typeof dark === "string") return dark;
					chooseTheme(dark.id);
					return null;
				},
				"/debug": () => {
					toggleChannel("model");
					return shown.model
						? "the model channel is hidden"
						: "the model channel is shown";
				},
			};
			return (await actions[canonicalCommand(name)]?.()) ?? null;
		},
		[
			toggleLeft,
			toggleRight,
			toggleChannel,
			shown,
			newChat,
			store,
			openModelPicker,
			theme,
			chooseTheme,
			openThemePicker,
			openFontPicker,
		],
	);
}
