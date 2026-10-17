import { Interp, runAsync } from "@repo/interpreter/lisp";
import { prelude } from "@repo/interpreter/prelude";
import { str } from "@repo/interpreter/print";
import { type HeldChat, MemoryWorkspaceStore } from "../src/ports.ts";
import { workspaceExtension } from "../src/workspace.ts";
import { workspaceHostFor } from "../src/workspace-host.ts";

export const MODELS = [
	"openrouter/google/gemma-4-31b-it",
	"digitalocean/gemma",
];

function heldChats(): HeldChat[] {
	return [
		{ id: "c1", title: "fix login", lines: [] },
		{ id: "c2", title: "plan q4", lines: [] },
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

export async function world(chatId: string | null = "c1"): Promise<World> {
	const store = new MemoryWorkspaceStore(
		{ name: "personal", model: MODELS[0] ?? "" },
		heldChats(),
	);
	const interp = new Interp({
		extensions: [
			workspaceExtension(
				workspaceHostFor({
					store,
					models: MODELS,
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
