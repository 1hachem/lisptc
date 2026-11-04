import { entryKind } from "@repo/shared/journal";
import { z } from "zod";

const activityIcons = ["tool", "model", "agent", "read", "write"] as const;

export type ActivityIcon = (typeof activityIcons)[number];

const activityImage = z.object({
	src: z.string(),
	theme: z.enum(["light", "dark"]).optional(),
});

export type ActivityImage = z.infer<typeof activityImage>;

const activityEntry = z.object({
	kind: z.string(),
	icon: z
		.union([z.enum(activityIcons), z.array(activityImage).min(1)])
		.optional(),
	label: z.string(),
	detail: z.string().optional(),
	state: z.enum(["started", "done", "failed", "held"]),
	error: z.string().optional(),
	id: z.string(),
	startedAt: z.number().optional(),
	ms: z.number().optional(),
	chat: z.string().optional(),
});

export type ActivityEntry = z.infer<typeof activityEntry>;

function mergedById(entries: readonly ActivityEntry[]): ActivityEntry[] {
	const merged = new Map<string, ActivityEntry>();
	for (const entry of entries) {
		const held = merged.get(entry.id);
		merged.set(entry.id, held === undefined ? entry : { ...held, ...entry });
	}
	return [...merged.values()];
}

export const activityKind = entryKind({
	name: "activity",
	schema: activityEntry,
	fold: mergedById,
});
