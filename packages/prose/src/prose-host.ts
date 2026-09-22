import { filePrompt } from "@repo/shared/host-node";
import { type ProseHost, readsAsProse } from "./prose.ts";

export const proseHost: ProseHost = {
	classifiers: [readsAsProse],
	prompt: filePrompt(new URL("./prose.ptc", import.meta.url)),
};
