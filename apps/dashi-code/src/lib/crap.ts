import { z } from "zod";

export const CRAPPY = 30;
export const CRAP_PREFIX = "crap-";
const KIND = "crap";
const ESTIMATED = "static_estimated";
const WORST = 12;
const P90 = 0.9;

const measuredSchema = z.object({
	path: z.string(),
	name: z.string(),
	line: z.number(),
	col: z.number().nullish(),
	cyclomatic: z.number().nullish(),
	crap: z.number().nullish(),
	coverage_pct: z.number().nullish(),
});

const healthSchema = z.object({
	summary: z.object({ coverage_model: z.string() }),
	findings: z.array(measuredSchema).default([]),
});

const worstSchema = z.object({
	file: z.string(),
	name: z.string(),
	line: z.number(),
	col: z.number(),
	crap: z.number(),
	cyclomatic: z.number().nullable(),
	coverage: z.number().nullable(),
});

const summarySchema = z.object({
	generated: z.number(),
	head: z.string(),
	functions: z.number(),
	total: z.number(),
	mean: z.number(),
	p90: z.number(),
	crappy: z.number(),
});

const pointSchema = summarySchema.extend({ worst: z.array(worstSchema) });

const documentSchema = pointSchema.extend({ kind: z.literal(KIND) });

export const crapSchema = z.object({
	latest: pointSchema,
	history: z.array(summarySchema),
});

export type CrapSummary = z.infer<typeof summarySchema>;
export type CrapPoint = z.infer<typeof pointSchema>;
export type Crap = z.infer<typeof crapSchema>;

export function crapPointOf(
	raw: unknown,
	head: string,
	generated: number,
): CrapPoint {
	const parsed = healthSchema.safeParse(raw);
	if (!parsed.success)
		throw new Error(`fallow health did not parse: ${parsed.error.message}`);
	const model = parsed.data.summary.coverage_model;
	if (model !== ESTIMATED)
		throw new Error(
			`fallow scored CRAP from ${model} coverage, not its estimate: a coverage/coverage-final.json at the repo root overrides it, so this point would not line up with the rest`,
		);
	const scored = parsed.data.findings.flatMap((finding) =>
		typeof finding.crap === "number"
			? [{ ...finding, crap: finding.crap }]
			: [],
	);
	if (scored.length === 0)
		throw new Error("fallow health scored no function for CRAP");
	const sorted = scored.map((finding) => finding.crap).sort((a, b) => a - b);
	const total = sorted.reduce((sum, value) => sum + value, 0);
	return {
		generated,
		head,
		functions: sorted.length,
		total,
		mean: total / sorted.length,
		p90:
			sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * P90))] ?? 0,
		crappy: sorted.filter((value) => value >= CRAPPY).length,
		worst: [...scored]
			.sort((a, b) => b.crap - a.crap)
			.slice(0, WORST)
			.map((finding) => ({
				file: finding.path,
				name: finding.name,
				line: finding.line,
				col: finding.col ?? 0,
				crap: finding.crap,
				cyclomatic: finding.cyclomatic ?? null,
				coverage: finding.coverage_pct ?? null,
			})),
	};
}

export function crapNameOf(point: CrapPoint): string {
	return `${CRAP_PREFIX}${Math.floor(point.generated / 1000)}-${point.head.slice(0, 7)}.json`;
}

export function crapDocumentOf(point: CrapPoint): string {
	return `${JSON.stringify({ kind: KIND, ...point }, null, 2)}\n`;
}

export function crapPointFrom(raw: unknown): CrapPoint | null {
	const parsed = documentSchema.safeParse(raw);
	return parsed.success ? pointSchema.parse(parsed.data) : null;
}

export function crapOf(stored: CrapPoint[]): Crap | null {
	const points = [...stored]
		.sort((a, b) => a.generated - b.generated)
		.filter((point, at, sorted) => sorted[at + 1]?.head !== point.head);
	const latest = points[points.length - 1];
	if (latest === undefined) return null;
	return {
		latest,
		history: points.map((point) => summarySchema.parse(point)),
	};
}
