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

const viewNode = z.object({
	tag: z.string(),
	props: z.record(z.string(), z.json()),
	get children() {
		return z.array(viewNode);
	},
});

export type ViewNode = z.infer<typeof viewNode>;

export const viewKey = annotationKey({
	name: "ui",
	lane: "output",
	schema: viewNode,
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
