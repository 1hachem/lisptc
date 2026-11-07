import { jev, openRouterEmbedder } from "@repo/models/providers";
import { filePrompt } from "@repo/shared/host-node";
import type { SemanticHost } from "./semantic.ts";

export const semanticHost: SemanticHost = {
	systemOne: jev,
	embedder: openRouterEmbedder,
	prompt: filePrompt(new URL("./semantic.ptc", import.meta.url)),
};
