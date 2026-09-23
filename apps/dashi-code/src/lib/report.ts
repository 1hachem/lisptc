import { z } from "zod";

export const verdictSchema = z.enum([
	"safe_to_delete",
	"review_required",
	"low_traffic",
	"coverage_unavailable",
	"active",
]);

export type Verdict = z.infer<typeof verdictSchema>;

export const riskBandSchema = z.enum(["low", "medium", "high"]);

const evidenceSchema = z.object({
	static_status: z.string().nullish(),
	test_coverage: z.string().nullish(),
	v8_tracking: z.string().nullish(),
	untracked_reason: z.string().nullish(),
	observation_days: z.number().nullish(),
	deployments_observed: z.number().nullish(),
});

export const runtimeFindingSchema = z.object({
	id: z.string(),
	stable_id: z.string().nullish(),
	source_hash: z.string().nullish(),
	path: z.string(),
	function: z.string(),
	line: z.number(),
	verdict: verdictSchema,
	confidence: z.string().nullish(),
	evidence: evidenceSchema.nullish(),
});

export const blastRadiusSchema = z.object({
	id: z.string(),
	stable_id: z.string().nullish(),
	file: z.string(),
	function: z.string(),
	line: z.number(),
	caller_count: z.number().nullish(),
	caller_count_weighted_by_traffic: z.number().nullish(),
	deploys_touched: z.number().nullish(),
	risk_band: riskBandSchema,
});

export const importanceSchema = z.object({
	id: z.string(),
	stable_id: z.string().nullish(),
	file: z.string(),
	function: z.string(),
	line: z.number(),
	invocations: z.number(),
	cyclomatic: z.number().nullish(),
	owner_count: z.number().nullish(),
	importance_score: z.number(),
	reason: z.string().nullish(),
});

export const captureQualitySchema = z.object({
	window_seconds: z.number().nullish(),
	instances_observed: z.number().nullish(),
	lazy_parse_warning: z.boolean().nullish(),
	untracked_ratio_percent: z.number().nullish(),
});

export const runtimeSummarySchema = z.object({
	data_source: z.string(),
	last_received_at: z.string().nullish(),
	functions_tracked: z.number(),
	functions_hit: z.number(),
	functions_unhit: z.number(),
	functions_untracked: z.number(),
	coverage_percent: z.number(),
	trace_count: z.number(),
	period_days: z.number().nullish(),
	deployments_seen: z.number().nullish(),
	capture_quality: captureQualitySchema.nullish(),
});

export const runtimeCoverageSchema = z.object({
	verdict: z.string().nullish(),
	signals: z.array(z.string()).default([]),
	actionable: z.boolean().nullish(),
	summary: runtimeSummarySchema,
	findings: z.array(runtimeFindingSchema).default([]),
	blast_radius: z.array(blastRadiusSchema).default([]),
	importance: z.array(importanceSchema).default([]),
});

export const complexityFindingSchema = z.object({
	path: z.string(),
	name: z.string(),
	line: z.number(),
	cyclomatic: z.number().nullish(),
	cognitive: z.number().nullish(),
	line_count: z.number().nullish(),
	severity: z.string().nullish(),
	crap: z.number().nullish(),
	coverage_tier: z.string().nullish(),
});

export const hotspotSchema = z.object({
	path: z.string(),
	score: z.number().nullish(),
	commits: z.number().nullish(),
	weighted_commits: z.number().nullish(),
	lines_added: z.number().nullish(),
	lines_deleted: z.number().nullish(),
	complexity_density: z.number().nullish(),
	fan_in: z.number().nullish(),
	trend: z.string().nullish(),
});

export const healthScoreSchema = z.union([
	z.number(),
	z.object({
		score: z.number(),
		grade: z.string().nullish(),
	}),
]);

export const reportSchema = z.object({
	schema_version: z.union([z.string(), z.number()]).nullish(),
	health_score: healthScoreSchema.nullish(),
	elapsed_ms: z.number().nullish(),
	runtime_coverage: runtimeCoverageSchema.nullish(),
	findings: z.array(complexityFindingSchema).default([]),
	hotspots: z.array(hotspotSchema).default([]),
});

const cycleEntry = z.union([
	z.array(z.string()),
	z.object({ cycle: z.array(z.string()) }),
	z.object({ files: z.array(z.string()) }),
	z.object({ members: z.array(z.string()) }),
	z.object({ paths: z.array(z.string()) }),
]);

export const deadCodeSchema = z.object({
	kind: z.string().nullish(),
	circular_dependencies: z.array(cycleEntry).default([]),
});

export interface Cycle {
	members: string[];
	length: number;
}

export function cyclesOf(raw: unknown): Cycle[] {
	const parsed = deadCodeSchema.safeParse(raw);
	if (!parsed.success) return [];
	return parsed.data.circular_dependencies
		.map((entry): Cycle => {
			const members = Array.isArray(entry)
				? entry
				: ((entry as Record<string, string[]>).cycle ??
					(entry as Record<string, string[]>).files ??
					(entry as Record<string, string[]>).members ??
					(entry as Record<string, string[]>).paths ??
					[]);
			return { members, length: members.length };
		})
		.filter((cycle) => cycle.members.length > 1)
		.sort((a, b) => b.length - a.length);
}

export type Report = z.infer<typeof reportSchema>;
export type RuntimeFinding = z.infer<typeof runtimeFindingSchema>;
export type BlastRadius = z.infer<typeof blastRadiusSchema>;
export type Importance = z.infer<typeof importanceSchema>;
export type ComplexityFinding = z.infer<typeof complexityFindingSchema>;
export type Hotspot = z.infer<typeof hotspotSchema>;

export function healthOf(
	report: Report,
): { score: number; grade: string | null } | null {
	const held = report.health_score;
	if (held === null || held === undefined) return null;
	if (typeof held === "number") return { score: held, grade: null };
	return { score: held.score, grade: held.grade ?? null };
}

const SHOWN_ISSUES = 3;

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

export function decodeReport(body: string): unknown {
	const lines = body.split("\n");
	const start = lines.findIndex((line) => line.startsWith("{"));
	if (start < 0) {
		const brace = body.indexOf("{");
		if (brace < 0) throw new Error("no JSON object in the document");
		return JSON.parse(body.slice(brace));
	}
	return JSON.parse(lines.slice(start).join("\n"));
}
