import { filePrompt } from "@repo/shared/host-node";
import type { KnowledgeHost, KnowledgeStore } from "./ports.ts";

const knowledgePrompt = filePrompt(new URL("./knowledge.ptc", import.meta.url));

export function knowledgeHostFor(options: {
	store: KnowledgeStore;
}): KnowledgeHost {
	return { ...options, prompt: knowledgePrompt };
}
