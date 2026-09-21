import type { Report, ReportRow, TranscriptLine } from "@repo/evals/report";
import { parseReport } from "@repo/evals/report";
import type { ReportStore } from "@repo/evals/storage";
import { reportStore } from "@repo/evals/storage";

export type { CaseInfo, ReportRow } from "@repo/evals/report";
export type Role = TranscriptLine["role"];

let opened: ReportStore | undefined;

function store(): ReportStore {
	opened ??= reportStore();
	return opened;
}

export type Tone = "green" | "yellow" | "red";

export interface Score {
	passed: number;
	total: number;
	tone: Tone;
}

function toneOf(passed: number, total: number): Tone {
	const average = total / 2;
	if (passed > average) return "green";
	return passed === average ? "yellow" : "red";
}

export function scoreOf(rows: ReportRow[]): Score {
	let passed = 0;
	let total = 0;
	for (const row of rows) {
		passed += row.checks.filter((check) => check.verdict === "true").length;
		total += row.checks.length;
	}
	return { passed, total, tone: toneOf(passed, total) };
}

export function targetOf(row: ReportRow): string {
	return `${row.provider} · ${row.model}`;
}

export interface TargetScore {
	target: string;
	score: Score;
}

function scoresByTarget(rows: ReportRow[]): TargetScore[] {
	const grouped = new Map<string, ReportRow[]>();
	for (const row of rows) {
		const target = targetOf(row);
		const held = grouped.get(target);
		if (held) held.push(row);
		else grouped.set(target, [row]);
	}
	return [...grouped].map(([target, held]) => ({
		target,
		score: scoreOf(held),
	}));
}

export type Loaded =
	| { file: string; ok: true; report: Report }
	| { file: string; ok: false; why: string };

export async function readReport(file: string): Promise<Loaded> {
	if (file.includes("/") || file.includes(".."))
		return { file, ok: false, why: "not a report in this directory" };
	try {
		const raw: unknown = JSON.parse(await store().read(file));
		const parsed = parseReport(raw);
		return parsed.ok
			? { file, ok: true, report: parsed.report }
			: { file, ok: false, why: parsed.why };
	} catch (err) {
		return {
			file,
			ok: false,
			why: err instanceof Error ? err.message : String(err),
		};
	}
}

export interface Ran {
	ok: true;
	file: string;
	ranAt: number;
	startedAt: string;
	targets: string[];
	byTarget: TargetScore[];
	cases: number;
	score: Score;
}

export type Listed =
	| Ran
	| { ok: false; file: string; ranAt: number; why: string };

export async function listReports(): Promise<Listed[]> {
	const stored = await store().list();
	const listed = await Promise.all(
		stored.map(async ({ name: file, modifiedAt: ranAt }): Promise<Listed> => {
			const loaded = await readReport(file);
			if (!loaded.ok) return { ok: false, file, ranAt, why: loaded.why };
			const { report } = loaded;
			return {
				ok: true,
				file,
				ranAt,
				startedAt: report.startedAt,
				targets: report.targets.map((t) => `${t.provider} · ${t.model}`),
				byTarget: scoresByTarget(report.rows),
				cases: report.rows.length,
				score: scoreOf(report.rows),
			};
		}),
	);
	return listed.sort((a, b) => b.ranAt - a.ranAt);
}

export function reportHome(): string {
	return store().describe();
}
