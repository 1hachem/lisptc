import { type ThemeScheme, themes } from "@repo/ui";
import { useCallback } from "react";
import { useAppearance } from "./appearance.tsx";
import { useChatStore } from "./chat.tsx";
import { useNewChat } from "./chats.ts";
import { useForkPicker } from "./fork-picker.tsx";
import { useModelPicker } from "./model-picker.tsx";
import { schemeVariant } from "./theme-uses.ts";
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
	{ name: "/light", desc: "switch to the light variant of the theme" },
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
		name: "/revert",
		desc: "fork the chat and its repl at an earlier message",
		aliases: ["/fork"],
	},
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
	const { openForkPicker } = useForkPicker();

	return useCallback(
		async (name: string): Promise<string | null> => {
			const switchScheme = (scheme: ThemeScheme): string | null => {
				const variant = schemeVariant(themes, theme, scheme);
				if (typeof variant === "string") return variant;
				chooseTheme(variant.id);
				return null;
			};
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
				"/revert": () => {
					if (store.getState().chatId === null) return "nothing to revert yet";
					openForkPicker();
					return null;
				},
				"/dark": () => switchScheme("dark"),
				"/light": () => switchScheme("light"),
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
			openForkPicker,
		],
	);
}
