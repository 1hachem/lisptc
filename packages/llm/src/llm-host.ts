import { filePrompt } from "@repo/shared/host-node";
import type { LlmHost } from "./llm.ts";
import { langchainGenerate } from "./llm-client.ts";

export const llmHost: LlmHost = {
	generate: langchainGenerate,
	prompt: filePrompt(new URL("./llm.ptc", import.meta.url)),
};
