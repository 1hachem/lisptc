import { useHotkeys } from "react-hotkeys-hook";

interface Binding {
	label: string;
	keys: string;
}

const keymap = {
	workspaceChat: {
		insert: { label: "i", keys: "i" },
	},
} as const satisfies Record<string, Record<string, Binding>>;

type KeymapContext = keyof typeof keymap;

const bindings: Record<KeymapContext, Record<string, Binding>> = keymap;

export function useKeymap<Context extends KeymapContext>(
	context: Context,
	action: Extract<keyof (typeof keymap)[Context], string>,
	run: () => void,
	{ enabled = true }: { enabled?: boolean } = {},
) {
	const binding = bindings[context][action];
	useHotkeys(binding.keys, run, { enabled, preventDefault: true }, [run]);
}
