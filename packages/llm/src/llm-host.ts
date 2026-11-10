import { systemClock } from "@repo/shared/host";
import { filePrompt } from "@repo/shared/host-node";
import type { LlmHost } from "./llm.ts";
import { chatGenerate } from "./llm-client.ts";

export const llmHost: LlmHost = {
	generate: chatGenerate,
	clock: systemClock,
	prompt: filePrompt(new URL("./llm.ptc", import.meta.url)),
};
