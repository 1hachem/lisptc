import { type Entry, entriesOf, entryKind } from "@repo/shared/journal";
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

export const activityKind = entryKind({
	name: "activity",
	schema: activityEntry,
});

export function activityOf(entries: readonly Entry[]): ActivityEntry[] {
	const merged: ActivityEntry[] = [];
	for (const entry of entriesOf(entries, activityKind)) {
		const at = merged.findIndex((e) => e.id === entry.id);
		if (at === -1) merged.push(entry);
		else merged[at] = { ...merged[at], ...entry };
	}
	return merged;
}
