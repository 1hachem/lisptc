import { Interp, runAsync } from "@repo/interpreter/lisp";
import { prelude } from "@repo/interpreter/prelude";
import { str } from "@repo/interpreter/print";
import {
	type HeldChat,
	MemoryWorkspaceStore,
	type ThemeChoice,
} from "../src/ports.ts";
import { workspaceExtension } from "../src/workspace.ts";
import { workspaceHostFor } from "../src/workspace-host.ts";

export const MODELS = [
	"openrouter/google/gemma-4-31b-it",
	"digitalocean/gemma",
];

export const ICONS = ["folder", "rocket"];

export const THEMES: ThemeChoice[] = [
	{
		id: "gruvbox-dark",
		name: "gruvbox dark",
		family: "gruvbox",
		scheme: "dark",
	},
	{
		id: "gruvbox-light",
		name: "gruvbox light",
		family: "gruvbox",
		scheme: "light",
	},
	{
		id: "tokyonight-dark",
		name: "tokyonight dark",
		family: "tokyonight",
		scheme: "dark",
	},
	{
		id: "tokyonight-light",
		name: "tokyonight light",
		family: "tokyonight",
		scheme: "light",
	},
	{ id: "paper", name: "paper light", family: "paper", scheme: "light" },
];

function heldChats(): HeldChat[] {
	return [
		{ id: "c1", title: "fix login", lines: [] },
		{
			id: "c2",
			title: "plan q4",
			lines: [
				{ role: "human", text: "why does the login redirect loop" },
				{ role: "ai", text: "the cookie is dropped" },
			],
		},
		{
			id: "c3",
			title: "login copy",
			lines: [
				{ role: "human", text: "first" },
				{ role: "ai", text: "second" },
				{ role: "human", text: "third" },
			],
		},
	];
}

export interface World {
	ev(code: string): Promise<string>;
	store: MemoryWorkspaceStore;
}

export async function world(
	chatId: string | null = "c1",
	theme = "gruvbox-dark",
): Promise<World> {
	const store = new MemoryWorkspaceStore(
		{ name: "personal", model: MODELS[0] ?? "", icon: "folder", theme },
		heldChats(),
	);
	const interp = new Interp({
		extensions: [
			workspaceExtension(
				workspaceHostFor({
					store,
					models: MODELS,
					icons: ICONS,
					themes: THEMES,
					defaultDarkTheme: "gruvbox-dark",
					chatId: chatId ?? undefined,
				}),
			),
		],
	});
	await runAsync(interp, prelude);
	return {
		store,
		ev: async (code) => str((await runAsync(interp, code)).value),
	};
}
