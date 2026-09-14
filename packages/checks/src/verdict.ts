import { z } from "zod";

export const verdictSchema = z.enum(["true", "false", "pending"]);

export const checkOutcomeSchema = z.object({
	name: z.string(),
	verdict: verdictSchema,
	step: z.number().optional(),
});

export type Verdict = z.infer<typeof verdictSchema>;
export type CheckOutcome = z.infer<typeof checkOutcomeSchema>;
