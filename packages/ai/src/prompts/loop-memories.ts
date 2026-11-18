import { filePrompt } from "@repo/shared/host-node";

export const LOOP_MEMORIES = filePrompt(
	new URL("./loop.memories.ptc", import.meta.url),
)();
