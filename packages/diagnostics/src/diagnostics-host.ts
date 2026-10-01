import { filePrompt } from "@repo/shared/host-node";
import { nameSearchEngine } from "./name-search.ts";
import type { DiagnosticsHost } from "./ports.ts";

export const diagnosticsHost: DiagnosticsHost = {
	prompt: filePrompt(new URL("./diagnostics.ptc", import.meta.url)),
	search: nameSearchEngine,
};
