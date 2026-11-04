import { filePrompt } from "@repo/shared/host-node";
import type { CompactionHost } from "./compaction.ts";

export const compactionHost: CompactionHost = {
	prompt: filePrompt(new URL("./compaction.ptc", import.meta.url)),
	memories: filePrompt(new URL("./compaction.memories.ptc", import.meta.url)),
};
