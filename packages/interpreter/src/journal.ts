import { ENVELOPE_KEYS } from "@repo/shared/messages";
import { z } from "zod";
import { type Channels, topic } from "./channels.ts";

export interface Entry {
	readonly kind: string;
	readonly value: unknown;
}

export interface EntryKind<T> {
	readonly name: string;
	readonly schema: z.ZodType<T>;
}

const RESERVED: ReadonlySet<string> = new Set(ENVELOPE_KEYS);

export function entryKind<T>(kind: EntryKind<T>): EntryKind<T> {
	if (RESERVED.has(kind.name))
		throw new Error(
			`entry kind "${kind.name}" is a message envelope field; pick another name`,
		);
	return kind;
}

export const journal = topic<Entry>("journal");

export function record<T>(
	channels: Channels | undefined,
	kind: EntryKind<T>,
	value: T,
): void {
	journal.emit(channels, { harness: { kind: kind.name, value } });
}

export function readEntry<T>(entry: Entry, kind: EntryKind<T>): T | undefined {
	return entry.kind === kind.name
		? kind.schema.safeParse(entry.value).data
		: undefined;
}

export function entriesOf<T>(
	entries: readonly Entry[],
	kind: EntryKind<T>,
): T[] {
	const values: T[] = [];
	for (const entry of entries) {
		const value = readEntry(entry, kind);
		if (value !== undefined) values.push(value);
	}
	return values;
}

export function latest<T>(
	entries: readonly Entry[],
	kind: EntryKind<T>,
): T | undefined {
	return entriesOf(entries, kind).at(-1);
}

export type Received = Record<string, unknown>;

export function readReceived<T>(
	received: Received | undefined,
	kind: EntryKind<T>,
): T | undefined {
	return received === undefined
		? undefined
		: kind.schema.safeParse(received[kind.name]).data;
}

const viewRef = z.object({ viewId: z.string() });

export type ViewRef = z.infer<typeof viewRef>;

export const viewKind = entryKind({ name: "ui", schema: viewRef });

const todo = z.object({ label: z.string(), done: z.boolean() });

export type Todo = z.infer<typeof todo>;

const progress = z
	.object({
		done: z.number().int().min(0),
		total: z.number().int().positive(),
		label: z.string().optional(),
	})
	.refine((p) => p.done <= p.total, "done exceeds total");

export type Progress = z.infer<typeof progress>;

const intentStep = z.object({
	text: z.string(),
	startedAt: z.number(),
	ms: z.number().optional(),
	state: z.enum(["running", "done", "failed"]),
	error: z.string().optional(),
});

export type IntentStep = z.infer<typeof intentStep>;

const intent = z.object({
	doing: z.string().optional(),
	todos: z.array(todo).optional(),
	progress: progress.optional(),
	log: z.array(intentStep).optional(),
});

export type Intent = z.infer<typeof intent>;

export const intentKind = entryKind({ name: "intent", schema: intent });

const question = z.object({
	id: z.string(),
	prompt: z.string(),
	choices: z.array(z.string()).min(1),
	multi: z.boolean(),
});

export type Question = z.infer<typeof question>;

export const questionKind = entryKind({ name: "question", schema: question });

const firedMemory = z.object({
	key: z.string().min(1),
	body: z.string(),
	on: z.string().optional(),
});

export type FiredMemory = z.infer<typeof firedMemory>;

export const memoryKind = entryKind({ name: "memory", schema: firedMemory });

export const activityIcons = [
	"tool",
	"model",
	"agent",
	"read",
	"write",
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
	ms: z.number().optional(),
	chat: z.string().optional(),
});

export type ActivityEntry = z.infer<typeof activityEntry>;

export type Activity = ActivityEntry[];

export const activityKind = entryKind({
	name: "activity",
	schema: activityEntry,
});

export function activityOf(entries: readonly Entry[]): Activity {
	const merged: Activity = [];
	for (const entry of entriesOf(entries, activityKind)) {
		const at = merged.findIndex((e) => e.id === entry.id);
		if (at === -1) merged.push(entry);
		else merged[at] = { ...merged[at], ...entry };
	}
	return merged;
}
