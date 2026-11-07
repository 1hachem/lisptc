import { entryKind, every } from "@repo/shared/journal";
import { z } from "zod";

const systemPrompt = z.object({
	text: z.string(),
	tokens: z.number().int().nonnegative().optional(),
});

export type SystemPrompt = z.infer<typeof systemPrompt>;

export const systemPromptKind = entryKind({
	name: "system-prompt",
	schema: systemPrompt,
	fold: every,
});
