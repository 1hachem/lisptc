import { entryKind, every } from "@repo/shared/journal";
import { z } from "zod";

const systemPrompt = z.object({ text: z.string() });

export type SystemPrompt = z.infer<typeof systemPrompt>;

export const systemPromptKind = entryKind({
	name: "system-prompt",
	schema: systemPrompt,
	fold: every,
});
