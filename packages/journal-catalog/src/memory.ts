import { entryKind } from "@repo/shared/journal";
import { z } from "zod";

const firedMemory = z.object({
	key: z.string().min(1),
	body: z.string(),
	on: z.string().optional(),
});

export type FiredMemory = z.infer<typeof firedMemory>;

export const memoryKind = entryKind({ name: "memory", schema: firedMemory });
