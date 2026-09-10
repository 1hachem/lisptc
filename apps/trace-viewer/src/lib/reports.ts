import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { evalsEnv } from "@repo/env/evals";
import type { Grade, Report, ReportRow } from "@repo/evals/report";
import { parseReport } from "@repo/evals/report";

export type { CaseInfo, ReportRow } from "@repo/evals/report";
export { GRADES } from "@repo/evals/report";

const REPORT_DIR = evalsEnv.EVAL_REPORT_DIR ?? join(process.cwd(), ".evals");

function emptyTally(): Record<Grade, number> {
	return { pass: 0, degraded: 0, fail: 0 };
}

export function tallyOf(rows: ReportRow[]): Record<Grade, number> {
	const tally = emptyTally();
	for (const row of rows) tally[row.grade] += 1;
	return tally;
}

function files(): string[] {
	try {
		return readdirSync(REPORT_DIR).filter((name) => name.endsWith(".json"));
	} catch {
		return [];
	}
}

export type Loaded =
	| { file: string; ok: true; report: Report }
	| { file: string; ok: false; why: string };

export function readReport(file: string): Loaded {
	if (file.includes("/") || file.includes(".."))
		return { file, ok: false, why: "not a report in this directory" };
	try {
		const raw: unknown = JSON.parse(
			readFileSync(join(REPORT_DIR, file), "utf8"),
		);
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

export type Listed =
	| {
			ok: true;
			file: string;
			ranAt: number;
			startedAt: string;
			targets: string[];
			cases: number;
			tally: Record<Grade, number>;
	  }
	| { ok: false; file: string; ranAt: number; why: string };

export function listReports(): Listed[] {
	return files()
		.map((file): Listed => {
			const ranAt = statSync(join(REPORT_DIR, file)).mtimeMs;
			const loaded = readReport(file);
			if (!loaded.ok) return { ok: false, file, ranAt, why: loaded.why };
			const { report } = loaded;
			return {
				ok: true,
				file,
				ranAt,
				startedAt: report.startedAt,
				targets: report.targets.map((t) => `${t.provider} · ${t.model}`),
				cases: report.rows.length,
				tally: tallyOf(report.rows),
			};
		})
		.sort((a, b) => b.ranAt - a.ranAt);
}

export function reportDir(): string {
	return REPORT_DIR;
}
