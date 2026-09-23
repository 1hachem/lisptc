import { z } from "zod";

const complexityFindingSchema = z.object({
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

const hotspotSchema = z.object({
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

const healthScoreSchema = z.union([
	z.number(),
	z.object({
		score: z.number(),
		grade: z.string().nullish(),
	}),
]);

const reportSchema = z.object({
	schema_version: z.union([z.string(), z.number()]).nullish(),
	health_score: healthScoreSchema.nullish(),
	elapsed_ms: z.number().nullish(),
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

const deadCodeSchema = z.object({
	kind: z.literal("dead-code"),
	circular_dependencies: z.array(cycleEntry).default([]),
});

export interface Cycle {
	members: string[];
	length: number;
}

export function cyclesOf(raw: unknown): Cycle[] | null {
	const parsed = deadCodeSchema.safeParse(raw);
	if (!parsed.success) return null;
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
