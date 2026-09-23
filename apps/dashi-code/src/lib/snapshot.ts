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

interface Cycles {
	file: string | null;
	cycles: Cycle[];
}

async function newestCycles(): Promise<Cycles> {
	const stored = [...(await listDocuments())].sort(
		(a, b) => b.modifiedAt - a.modifiedAt,
	);
	for (const row of stored) {
		const found = cyclesOf(await readDocument(row.name));
		if (found !== null) return { file: row.name, cycles: found };
	}
	return { file: null, cycles: [] };
}

let cached: { key: string; value: Snapshot } | undefined;

export async function snapshot(): Promise<Snapshot> {
	const [history, latest, cycles] = await Promise.all([
		readHistory(),
		newest(),
		newestCycles(),
	]);
	const key = `${history.head}:${latest?.file ?? "none"}:${cycles.file ?? "none"}`;
	if (cached?.key === key) return cached.value;
	const value = await compose(history, latest, cycles.cycles);
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
	cycles: Cycle[],
): Promise<Snapshot> {
	const tree = await readTree();
	const report = latest?.report;
	const functions = functionsOf(report);
	const files = filesOf(history, tree, complexityOf(functions), report);

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
		cycles,
		report: latest?.file ?? null,
	};
}

function functionsOf(report: Report | undefined): FunctionRow[] {
	const functions: FunctionRow[] = [];
	for (const finding of report?.findings ?? [])
		functions.push({
			file: finding.path,
			name: finding.name,
			line: finding.line,
			complexity: finding.cyclomatic ?? 0,
			cognitive: finding.cognitive ?? null,
			loc: finding.line_count ?? null,
			crap: finding.crap ?? null,
			severity: finding.severity ?? null,
		});
	return functions;
}

function complexityOf(functions: FunctionRow[]): Map<string, FileComplexity> {
	const perFile = new Map<string, FileComplexity>();
	for (const finding of functions) {
		const held = perFile.get(finding.file) ?? { total: 0, max: 0, count: 0 };
		held.total += finding.complexity;
		held.max = Math.max(held.max, finding.complexity);
		held.count += 1;
		perFile.set(finding.file, held);
	}
	return perFile;
}

function filesOf(
	history: History,
	tree: Awaited<ReturnType<typeof readTree>>,
	perFile: Map<string, FileComplexity>,
	report: Report | undefined,
): FileRow[] {
	const spots = new Map(
		(report?.hotspots ?? []).map((spot) => [spot.path, spot]),
	);

	return history.files.map((file) =>
		fileOf(file, tree.sizes, perFile.get(file.path), spots.get(file.path)),
	);
}

function fileOf(
	file: History["files"][number],
	sizes: Record<string, number>,
	complexity: FileComplexity | undefined,
	spot: Report["hotspots"][number] | undefined,
): FileRow {
	return {
		...file,
		...sizeFields(sizes[file.path]),
		...complexityFields(complexity),
		...hotspotFields(spot),
	};
}

function sizeFields(loc: number | undefined): Pick<FileRow, "tracked" | "loc"> {
	return { tracked: loc !== undefined, loc: loc ?? null };
}

function complexityFields(
	complexity: FileComplexity | undefined,
): Pick<FileRow, "totCx" | "maxCx" | "fns"> {
	return {
		totCx: complexity?.total ?? null,
		maxCx: complexity?.max ?? null,
		fns: complexity?.count ?? null,
	};
}

function hotspotFields(
	spot: Report["hotspots"][number] | undefined,
): Pick<FileRow, "fanIn" | "score"> {
	return { fanIn: spot?.fan_in ?? null, score: spot?.score ?? null };
}

interface FileComplexity {
	total: number;
	max: number;
	count: number;
}
