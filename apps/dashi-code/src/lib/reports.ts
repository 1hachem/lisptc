import type { Report, Verdict } from "./report.ts";
import { decodeReport, parseReport } from "./report.ts";
import type { DocumentStore, StoredDocument } from "./store.ts";
import { documentStore } from "./store.ts";

let opened: DocumentStore | undefined;

function store(): DocumentStore {
	opened ??= documentStore();
	return opened;
}

export function storeHome(): string {
	return store().describe();
}

export async function listDocuments(): Promise<StoredDocument[]> {
	return await store().list();
}

export function kindOf(raw: unknown): string | null {
	const held = (raw as { kind?: unknown } | null)?.kind;
	return typeof held === "string" ? held : null;
}

const NOT_REPORTS = new Set(["dead-code", "dashi-snapshot"]);

export async function removeReport(file: string): Promise<void> {
	if (file.includes("/") || file.includes("..") || !file.endsWith(".json"))
		throw new Error(`${file} is not a stored document`);
	const kind = kindOf(await readDocument(file));
	if (kind !== null && NOT_REPORTS.has(kind))
		throw new Error(`${file} is a ${kind} document, not a runtime report`);
	await store().remove(file);
}

export async function readDocument(file: string): Promise<unknown | null> {
	if (file.includes("/") || file.includes("..")) return null;
	try {
		return decodeReport(await store().read(file));
	} catch {
		return null;
	}
}

export type Loaded =
	| { file: string; ok: true; report: Report }
	| { file: string; ok: false; why: string };

export async function readReport(file: string): Promise<Loaded> {
	if (file.includes("/") || file.includes(".."))
		return { file, ok: false, why: "not a report in this store" };
	try {
		const raw = decodeReport(await store().read(file));
		const kind = kindOf(raw);
		if (kind !== null && kind !== "health")
			return { file, ok: false, why: `${kind} document, not a runtime report` };
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

export const VERDICTS: Verdict[] = [
	"safe_to_delete",
	"review_required",
	"low_traffic",
	"coverage_unavailable",
	"active",
];

export type VerdictCount = { verdict: Verdict; count: number };

export function countVerdicts(report: Report): VerdictCount[] {
	const counted = new Map<Verdict, number>();
	for (const finding of report.runtime_coverage?.findings ?? [])
		counted.set(finding.verdict, (counted.get(finding.verdict) ?? 0) + 1);
	return VERDICTS.map((verdict) => ({
		verdict,
		count: counted.get(verdict) ?? 0,
	}));
}

export interface Listed {
	file: string;
	storedAt: number;
	ok: boolean;
	why?: string;
	dataSource?: string;
	tracked?: number;
	hit?: number;
	untracked?: number;
	coveragePercent?: number;
	traceCount?: number;
	deletable?: number;
}

export async function listReports(): Promise<Listed[]> {
	const stored = await store().list();
	const kinds = await Promise.all(
		stored.map(async (row) => kindOf(await readDocument(row.name))),
	);
	const reports = stored.filter((_, index) => {
		const kind = kinds[index];
		return kind === null || kind === undefined || !NOT_REPORTS.has(kind);
	});
	const listed = await Promise.all(
		reports.map(
			async ({ name: file, modifiedAt: storedAt }): Promise<Listed> => {
				const loaded = await readReport(file);
				if (!loaded.ok) return { file, storedAt, ok: false, why: loaded.why };
				const runtime = loaded.report.runtime_coverage;
				if (runtime === null || runtime === undefined)
					return { file, storedAt, ok: true, dataSource: "static only" };
				const { summary, findings } = runtime;
				return {
					file,
					storedAt,
					ok: true,
					dataSource: summary.data_source,
					tracked: summary.functions_tracked,
					hit: summary.functions_hit,
					untracked: summary.functions_untracked,
					coveragePercent: summary.coverage_percent,
					traceCount: summary.trace_count,
					deletable: findings.filter(
						(finding) => finding.verdict === "safe_to_delete",
					).length,
				};
			},
		),
	);
	return listed.sort((a, b) => b.storedAt - a.storedAt);
}
