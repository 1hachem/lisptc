import { filePrompt } from "@repo/shared/host-node";
import type { ProseHost } from "./prose.ts";

export const proseHost: ProseHost = {
	prompt: filePrompt(new URL("./prose.ptc", import.meta.url)),
};
