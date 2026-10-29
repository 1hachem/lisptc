import { ENVELOPE_KEYS } from "@repo/shared/messages";
import { z } from "zod";
import {
	type Annotations,
	annotating,
	type StepAnnotations,
} from "./session.ts";

export type Lane = keyof StepAnnotations;

export interface AnnotationKey<T> {
	readonly name: string;
	readonly lane: Lane;
	readonly schema: z.ZodType<T>;
}

const RESERVED: ReadonlySet<string> = new Set(ENVELOPE_KEYS);

export function annotationKey<T>(key: AnnotationKey<T>): AnnotationKey<T> {
	if (RESERVED.has(key.name))
		throw new Error(
			`annotation key "${key.name}" is a message envelope field; pick another name`,
		);
	return key;
}

export function annotate<T>(
	into: StepAnnotations,
	key: AnnotationKey<T>,
	value: T,
): StepAnnotations {
	return annotating(into, key.lane, { [key.name]: value });
}

export function readAnnotation<T>(
	bag: Annotations | undefined,
	key: AnnotationKey<T>,
): T | undefined {
	return bag === undefined
		? undefined
		: key.schema.safeParse(bag[key.name]).data;
}

const viewRef = z.object({ viewId: z.string() });

export type ViewRef = z.infer<typeof viewRef>;

export const viewKey = annotationKey({
	name: "ui",
	lane: "output",
	schema: viewRef,
});

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

export const intentKey = annotationKey({
	name: "intent",
	lane: "output",
	schema: intent,
});

const question = z.object({
	id: z.string(),
	prompt: z.string(),
	choices: z.array(z.string()).min(1),
	multi: z.boolean(),
});

export type Question = z.infer<typeof question>;

export const questionKey = annotationKey({
	name: "question",
	lane: "output",
	schema: question,
});

const firedMemory = z.object({
	key: z.string().min(1),
	body: z.string(),
	on: z.string().optional(),
});

export type FiredMemory = z.infer<typeof firedMemory>;

export const memoriesKey = annotationKey({
	name: "memories",
	lane: "step",
	schema: z.array(firedMemory).min(1),
});

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

export const activityKey = annotationKey({
	name: "activity",
	lane: "output",
	schema: z.array(activityEntry).min(1),
});

export function recordActivity(
	into: StepAnnotations,
	entries: readonly ActivityEntry[],
): StepAnnotations {
	if (entries.length === 0) return into;
	const merged = [
		...(readAnnotation(into[activityKey.lane], activityKey) ?? []),
	];
	for (const entry of entries) {
		const at = merged.findIndex((e) => e.id === entry.id);
		if (at === -1) merged.push(entry);
		else merged[at] = { ...merged[at], ...entry };
	}
	return annotate(into, activityKey, merged);
}
