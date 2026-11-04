import { type Entry, entriesOf, entryKind } from "@repo/shared/journal";
import { z } from "zod";

const askAnswer = z
	.object({
		action: z.string(),
		values: z.record(z.string(), z.union([z.string(), z.boolean()])).readonly(),
	})
	.readonly();

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

export const asksKind = entryKind({ name: "asks", schema: asks });

export function asksOf(entries: readonly Entry[]): Asks {
	const open: Ask[] = [];
	let answered: Record<string, Answered> = {};
	for (const added of entriesOf(entries, asksKind)) {
		open.push(...(added.open ?? []));
		answered = { ...answered, ...added.answered };
	}
	return {
		...(open.length > 0 ? { open } : {}),
		...(Object.keys(answered).length > 0 ? { answered } : {}),
	};
}

export function unansweredAsks(asks: Asks | undefined): readonly Ask[] {
	const answered = asks?.answered ?? {};
	return (asks?.open ?? []).filter((ask) => !(ask.id in answered));
}

export function answering(id: string, answer: Answered): Asks {
	return { answered: { [id]: answer } };
}
