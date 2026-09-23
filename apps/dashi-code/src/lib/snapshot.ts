import type { History, Pair, Timeline, Trend } from "./git.ts";
import { readHistory } from "./git.ts";
import type { Cycle, Report } from "./report.ts";
import { cyclesOf } from "./report.ts";
import { listDocuments, readDocument, readReport } from "./reports.ts";
import type { Edge, Workspace } from "./workspaces.ts";
import { readTree } from "./workspaces.ts";

export interface FileRow {
	path: string;
	pkg: string;
	isTest: boolean;
	commits: number;
	added: number;
	deleted: number;
	first: string;
	last: string;
	trend: Trend;
	tracked: boolean;
	loc: number | null;
	totCx: number | null;
	maxCx: number | null;
	fns: number | null;
	fanIn: number | null;
	score: number | null;
}

export interface FunctionRow {
	file: string;
	name: string;
	line: number;
	complexity: number;
	cognitive: number | null;
	loc: number | null;
	crap: number | null;
	severity: string | null;
}

export interface Snapshot {
	generated: number;
	head: string;
	commits: number;
	authors: number;
	layers: string[];
	nodes: Workspace[];
	edges: Edge[];
	files: FileRow[];
	functions: FunctionRow[];
	timeline: Timeline;
	cochange: { files: Pair[]; packages: Pair[] };
	report: string | null;
	cycles: Cycle[];
}

async function newestCycles(): Promise<Cycle[]> {
	const stored = [...(await listDocuments())].sort(
		(a, b) => b.modifiedAt - a.modifiedAt,
	);
	for (const row of stored) {
		const found = cyclesOf(await readDocument(row.name));
		if (found.length > 0) return found;
	}
	return [];
}

let cached: { key: string; value: Snapshot } | undefined;

export async function snapshot(): Promise<Snapshot> {
	const [history, latest] = await Promise.all([readHistory(), newest()]);
	const key = `${history.head}:${latest?.file ?? "none"}`;
	if (cached?.key === key) return cached.value;
	const value = await compose(history, latest);
	cached = { key, value };
	return value;
}

async function newest(): Promise<{ file: string; report: Report } | null> {
	const stored = [...(await listDocuments())].sort(
		(a, b) => b.modifiedAt - a.modifiedAt,
	);
	for (const row of stored) {
		const loaded = await readReport(row.name);
		if (loaded.ok) return { file: loaded.file, report: loaded.report };
	}
	return null;
}

async function compose(
	history: History,
	latest: { file: string; report: Report } | null,
): Promise<Snapshot> {
	const tree = await readTree();
	const report = latest?.report;

	const perFile = new Map<
		string,
		{ total: number; max: number; count: number }
	>();
	const functions: FunctionRow[] = [];
	for (const finding of report?.findings ?? []) {
		const complexity = finding.cyclomatic ?? 0;
		const held = perFile.get(finding.path) ?? { total: 0, max: 0, count: 0 };
		held.total += complexity;
		held.max = Math.max(held.max, complexity);
		held.count += 1;
		perFile.set(finding.path, held);
		functions.push({
			file: finding.path,
			name: finding.name,
			line: finding.line,
			complexity,
			cognitive: finding.cognitive ?? null,
			loc: finding.line_count ?? null,
			crap: finding.crap ?? null,
			severity: finding.severity ?? null,
		});
	}

	const spots = new Map(
		(report?.hotspots ?? []).map((spot) => [spot.path, spot]),
	);

	const files: FileRow[] = history.files.map((file) => {
		const complexity = perFile.get(file.path);
		const spot = spots.get(file.path);
		return {
			...file,
			tracked: tree.sizes[file.path] !== undefined,
			loc: tree.sizes[file.path] ?? null,
			totCx: complexity?.total ?? null,
			maxCx: complexity?.max ?? null,
			fns: complexity?.count ?? null,
			fanIn: spot?.fan_in ?? null,
			score: spot?.score ?? null,
		};
	});

	return {
		generated: Date.now(),
		head: history.head,
		commits: history.commits,
		authors: history.authors,
		layers: tree.layers,
		nodes: tree.nodes,
		edges: tree.edges,
		files,
		functions,
		timeline: history.timeline,
		cochange: history.cochange,
		cycles: await newestCycles(),
		report: latest?.file ?? null,
	};
}
