import { z } from "zod";

export const gradeSchema = z.enum(["pass", "degraded", "fail"]);

export const verdictSchema = z.enum(["true", "false", "pending"]);

export const transcriptLineSchema = z.object({
	role: z.enum(["user", "assistant", "tool"]),
	content: z.string(),
});

export const checkOutcomeSchema = z.object({
	name: z.string(),
	verdict: verdictSchema,
	step: z.number().optional(),
});

export const targetSchema = z.object({
	provider: z.string(),
	model: z.string(),
});

export const reportRowSchema = z.object({
	case: z.string(),
	sample: z.number(),
	provider: z.string(),
	model: z.string(),
	grade: gradeSchema,
	steps: z.number(),
	min: z.number(),
	max: z.number(),
	halted: z.boolean(),
	answer: z.string(),
	inputTokens: z.number(),
	outputTokens: z.number(),
	durationMs: z.number(),
	errors: z.number(),
	skips: z.number(),
	checks: z.array(checkOutcomeSchema),
	transcript: z.array(transcriptLineSchema),
});

export const seedTurnSchema = z.object({
	role: z.enum(["user", "assistant"]),
	content: z.string(),
});

export const mockedServerSchema = z.object({
	name: z.string(),
	tools: z.array(z.string()),
	answers: z.array(z.string()),
	connectDelayMs: z.number().optional(),
	fails: z.string().optional(),
});

export const caseInfoSchema = z.object({
	name: z.string(),
	min: z.number(),
	max: z.number(),
	samples: z.number(),
	passRate: z.number().optional(),
	systemPrompt: z.enum(["default", "custom"]),
	checks: z.string(),
	seed: z.array(seedTurnSchema),
	mocks: z.array(mockedServerSchema),
});

export const reportSchema = z.object({
	startedAt: z.string(),
	sha: z.string(),
	targets: z.array(targetSchema),
	cases: z.array(caseInfoSchema),
	rows: z.array(reportRowSchema),
});

export type Grade = z.infer<typeof gradeSchema>;
export type Verdict = z.infer<typeof verdictSchema>;
export type TranscriptLine = z.infer<typeof transcriptLineSchema>;
export type CheckOutcome = z.infer<typeof checkOutcomeSchema>;
export type Target = z.infer<typeof targetSchema>;
export type SeedTurn = z.infer<typeof seedTurnSchema>;
export type MockedServer = z.infer<typeof mockedServerSchema>;
export type CaseInfo = z.infer<typeof caseInfoSchema>;
export type ReportRow = z.infer<typeof reportRowSchema>;
export type Report = z.infer<typeof reportSchema>;

export const GRADES: Grade[] = gradeSchema.options;

const SHOWN_ISSUES = 4;

export type ParsedReport =
	| { ok: true; report: Report }
	| { ok: false; why: string };

export function parseReport(raw: unknown): ParsedReport {
	const result = reportSchema.safeParse(raw);
	if (result.success) return { ok: true, report: result.data };
	const issues = result.error.issues.map(
		(issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`,
	);
	const rest = issues.length - SHOWN_ISSUES;
	const head = issues.slice(0, SHOWN_ISSUES).join(", ");
	return { ok: false, why: rest > 0 ? `${head}, and ${rest} more` : head };
}
