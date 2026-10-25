import { filePrompt } from "@repo/shared/host-node";
import type { ThemeChoice, WorkspaceHost, WorkspaceStore } from "./ports.ts";

const workspacePrompt = filePrompt(new URL("./workspace.ptc", import.meta.url));

export function workspaceHostFor(options: {
	store: WorkspaceStore;
	models: readonly string[];
	icons: readonly string[];
	themes: readonly ThemeChoice[];
	defaultDarkTheme?: string;
	chatId?: string;
}): WorkspaceHost {
	return { ...options, prompt: workspacePrompt };
}
