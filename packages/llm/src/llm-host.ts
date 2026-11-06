import { systemClock } from "@repo/shared/host";
import { filePrompt } from "@repo/shared/host-node";
import type { LlmHost } from "./llm.ts";
import { langchainGenerate } from "./llm-client.ts";

export const llmHost: LlmHost = {
	generate: langchainGenerate,
	clock: systemClock,
	prompt: filePrompt(new URL("./llm.ptc", import.meta.url)),
	memories: filePrompt(new URL("./llm.memories.ptc", import.meta.url)),
};
