import { filePrompt } from "@repo/shared/host-node";
import { type ProseHost, readsAsProse } from "./ports.ts";

export const proseHost: ProseHost = {
	classifiers: [readsAsProse],
	prompt: filePrompt(new URL("./prose.ptc", import.meta.url)),
	memories: filePrompt(new URL("./prose.memories.ptc", import.meta.url)),
};
