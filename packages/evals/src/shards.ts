import { mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { evalsEnv } from "@repo/env/evals";
import type { CaseInfo, Report, ReportRow } from "./report.ts";
import { parseReport } from "./report.ts";

export const REPORT_DIR =
	evalsEnv.EVAL_REPORT_DIR ?? join(process.cwd(), ".evals");

const PARTS_DIR = join(REPORT_DIR, "parts");

function slug(text: string): string {
	return text
		.replace(/[^A-Za-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 60);
}

export function reportName(report: Report): string {
	const named = report.targets
		.slice(0, 3)
		.map((target) => slug(`${target.provider}-${target.model}`));
	if (report.targets.length > 3)
		named.push(`and-${report.targets.length - 3}-more`);
	return `${report.startedAt}__${named.join("__")}.json`;
}

export function clearParts(): void {
	rmSync(PARTS_DIR, { recursive: true, force: true });
}

export function shardPath(id: string): string {
	mkdirSync(PARTS_DIR, { recursive: true });
	return join(PARTS_DIR, `${id}.json`);
}

function shards(): Report[] {
	let names: string[];
	try {
		names = readdirSync(PARTS_DIR).filter((name) => name.endsWith(".json"));
	} catch {
		return [];
	}
	const out: Report[] = [];
	for (const name of names.sort()) {
		const parsed = parseReport(
			JSON.parse(readFileSync(join(PARTS_DIR, name), "utf8")),
		);
		if (parsed.ok) out.push(parsed.report);
		else console.warn(`[evals] unreadable shard ${name}: ${parsed.why}`);
	}
	return out;
}

export function mergeShards(): Report | undefined {
	const parts = shards();
	const first = parts[0];
	if (!first) return undefined;
	const cases = new Map<string, CaseInfo>();
	const rows: ReportRow[] = [];
	for (const part of parts) {
		for (const info of part.cases) cases.set(info.name, info);
		rows.push(...part.rows);
	}
	return {
		startedAt: parts
			.map((part) => part.startedAt)
			.reduce((a, b) => (a < b ? a : b)),
		sha: first.sha,
		targets: first.targets,
		cases: [...cases.values()],
		rows: rows.sort(
			(a, b) => a.case.localeCompare(b.case) || a.sample - b.sample,
		),
	};
}
