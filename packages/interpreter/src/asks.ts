import { z } from "zod";
import { annotate, annotationKey, readAnnotation } from "./annotations.ts";
import type { StepAnnotations } from "./session.ts";

const askAnswer = z
	.object({
		action: z.string(),
		values: z.record(z.string(), z.union([z.string(), z.boolean()])).readonly(),
	})
	.readonly();

export type AskAnswer = z.infer<typeof askAnswer>;

const askChoice = z
	.object({
		label: z.string(),
		done: z.string().optional(),
		accepts: z.boolean(),
		answer: askAnswer,
		opens: z.string().optional(),
		primary: z.literal(true).optional(),
	})
	.transform((choice) => ({ ...choice, done: choice.done ?? choice.label }))
	.readonly();

export type AskChoice = z.infer<typeof askChoice>;

const ask = z
	.object({
		id: z.string(),
		title: z.string(),
		detail: z.string().optional(),
		prompt: z.string(),
		choices: z.array(askChoice).readonly(),
		answerApplies: z.literal(true).optional(),
	})
	.readonly();

export type Ask = z.infer<typeof ask>;

const answered = z
	.object({ accepted: z.boolean(), label: z.string() })
	.readonly();

export type Answered = z.infer<typeof answered>;

const asks = z
	.object({
		open: z.array(ask).readonly().optional(),
		answered: z.record(z.string(), answered).readonly().optional(),
	})
	.readonly();

export type Asks = z.infer<typeof asks>;

export const asksKey = annotationKey({
	name: "asks",
	lane: "output",
	schema: asks,
});

export function unansweredAsks(asks: Asks | undefined): readonly Ask[] {
	const answered = asks?.answered ?? {};
	return (asks?.open ?? []).filter((ask) => !(ask.id in answered));
}

export function answering(
	asks: Asks | undefined,
	id: string,
	answer: Answered,
): Asks {
	return { ...asks, answered: { ...asks?.answered, [id]: answer } };
}

export function asking(into: StepAnnotations, add: Asks): StepAnnotations {
	const open = add.open ?? [];
	const answered = add.answered ?? {};
	if (open.length === 0 && Object.keys(answered).length === 0) return into;
	const held = readAnnotation(into.output, asksKey) ?? {};
	const merged: Asks = {
		...(open.length > 0 || held.open
			? { open: [...(held.open ?? []), ...open] }
			: {}),
		...(Object.keys(answered).length > 0 || held.answered
			? { answered: { ...held.answered, ...answered } }
			: {}),
	};
	return annotate(into, asksKey, merged);
}
