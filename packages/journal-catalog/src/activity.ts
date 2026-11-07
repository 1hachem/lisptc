import { entryKind } from "@repo/shared/journal";
import { z } from "zod";

const activityIcons = [
	"tool",
	"model",
	"agent",
	"read",
	"write",
	"meaning",
] as const;

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
	endedAt: z.number().optional(),
	ms: z.number().optional(),
	chat: z.string().optional(),
});

export type ActivityEntry = z.infer<typeof activityEntry>;

function stamped(entry: ActivityEntry, at: number): ActivityEntry {
	if (entry.state === "started")
		return { ...entry, startedAt: entry.startedAt ?? at };
	return { ...entry, endedAt: entry.endedAt ?? at };
}

function timed(entry: ActivityEntry): ActivityEntry {
	const { startedAt, endedAt } = entry;
	if (startedAt === undefined || endedAt === undefined) return entry;
	return { ...entry, ms: Math.max(0, endedAt - startedAt) };
}

function mergedById(entries: readonly ActivityEntry[]): ActivityEntry[] {
	const merged = new Map<string, ActivityEntry>();
	for (const entry of entries) {
		const held = merged.get(entry.id);
		merged.set(
			entry.id,
			timed(held === undefined ? entry : { ...held, ...entry }),
		);
	}
	return [...merged.values()];
}

export const activityKind = entryKind({
	name: "activity",
	schema: activityEntry,
	stamp: stamped,
	fold: mergedById,
});
