import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useCallback, useMemo, useRef, useState } from "react";
import type { Command } from "./commands.ts";
import { newestFirst } from "./message-history.ts";
import type { Flash } from "./notice.ts";

export function useMenus() {
	const host = useRef<HTMLDivElement>(null);
	const commandOpen = useRef(false);
	const mentionOpen = useRef(false);
	const assistOpen = useRef(false);
	const active = useMemo(
		() => ({
			get current() {
				return commandOpen.current || mentionOpen.current || assistOpen.current;
			},
		}),
		[],
	);
	return { host, commandOpen, mentionOpen, assistOpen, active };
}

export function usePromptSearch(
	history: string[],
	replace: (text: string) => void,
) {
	const [editor] = useLexicalComposerContext();
	const [searching, setSearching] = useState(false);
	const prompts = useMemo(() => newestFirst(history), [history]);
	const insert = useCallback(
		(prompt: string) => {
			replace(prompt);
			editor.focus();
		},
		[editor, replace],
	);
	return { searching, setSearching, prompts, insert };
}

export function usePick({
	replace,
	onCommand,
	flash,
	search,
	attach,
}: {
	replace: (text: string) => void;
	onCommand?: (name: string) => Promise<string | null>;
	flash: Flash;
	search: (open: boolean) => void;
	attach: () => void;
}) {
	const [editor] = useLexicalComposerContext();
	return useCallback(
		(command: Command) => {
			if (command.takesArgument) {
				replace(`${command.name} `);
				editor.focus();
				return;
			}
			replace("");
			if (command.name === "/prompt") {
				search(true);
				return;
			}
			if (command.name === "/attachment") {
				attach();
				return;
			}
			void Promise.resolve(onCommand?.(command.name)).then((shown) => {
				if (shown) flash(shown);
			});
		},
		[editor, replace, onCommand, flash, search, attach],
	);
}
