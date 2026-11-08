import { latestOnly } from "@repo/shared/journal";
import { z } from "zod";

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

export const intentKind = latestOnly({ name: "intent", schema: intent });

const question = z.object({
	id: z.string(),
	prompt: z.string(),
	choices: z.array(z.string()).min(1),
	multi: z.boolean(),
});

export type Question = z.infer<typeof question>;

export const questionKind = latestOnly({ name: "question", schema: question });
