import { jev, openRouterEmbedder } from "@repo/models/providers";
import { systemClock } from "@repo/shared/host";
import { filePrompt } from "@repo/shared/host-node";
import type { SemanticHost } from "./semantic.ts";

export const semanticHost: SemanticHost = {
	systemOne: jev,
	embedder: openRouterEmbedder,
	clock: systemClock,
	prompt: filePrompt(new URL("./semantic.ptc", import.meta.url)),
	memories: filePrompt(new URL("./semantic.memories.ptc", import.meta.url)),
};
