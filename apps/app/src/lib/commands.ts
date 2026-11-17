import { type ThemeScheme, themes } from "@repo/ui";
import { COMMANDS, type Command } from "@repo/ui-catalog";
import { useCallback } from "react";
import { useAppearance } from "./appearance.tsx";
import { useChatStore } from "./chat.tsx";
import { useNewChat } from "./chats.ts";
import { useForkPicker } from "./fork-picker.tsx";
import { useModelPicker } from "./model-picker.tsx";
import type { PanelContent } from "./panel-ops.ts";
import { requestPanel } from "./panel-requests.ts";
import { useSideTrace } from "./side-trace.tsx";
import { schemeVariant } from "./theme-uses.ts";
import { transcript } from "./transcript.ts";
import { useUI } from "./ui.tsx";

const PREFERENCES: PanelContent = {
	kind: "page",
	page: "preferences",
	title: "preferences",
};

export function matchesCommand(command: Command, typed: string): boolean {
	const query = typed.toLowerCase();
	return [command.name, ...(command.aliases ?? [])].some((name) =>
		name.slice(1).startsWith(query),
	);
}

export function canonicalCommand(typed: string): string {
	const name = typed.toLowerCase();
	return (
		COMMANDS.find(
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
	const { toggleLeft, toggleRight } = useUI();
	const store = useChatStore();
	const newChat = useNewChat();
	const { openModelPicker } = useModelPicker();
	const { theme, chooseTheme, openThemePicker, openFontPicker } =
		useAppearance();
	const { openForkPicker } = useForkPicker();
	const sideTrace = useSideTrace();

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
				"/right": quietly(toggleRight),
				"/preferences": quietly(() => requestPanel(PREFERENCES)),
				"/model": quietly(openModelPicker),
				"/theme": quietly(openThemePicker),
				"/font": quietly(openFontPicker),
				"/revert": () => {
					if (store.getState().chatId === null) return "nothing to revert yet";
					openForkPicker();
					return null;
				},
				"/trace": () => {
					if (store.getState().chatId === null || sideTrace === null)
						return "nothing to trace yet";
					sideTrace.toggle();
					return null;
				},
				"/dark": () => switchScheme("dark"),
				"/light": () => switchScheme("light"),
			};
			return (await actions[canonicalCommand(name)]?.()) ?? null;
		},
		[
			toggleLeft,
			toggleRight,
			newChat,
			store,
			openModelPicker,
			theme,
			chooseTheme,
			openThemePicker,
			openFontPicker,
			openForkPicker,
			sideTrace,
		],
	);
}
