import type { Crap, CrapPoint } from "./crap.ts";
import { CRAP_PREFIX, crapOf, crapPointFrom } from "./crap.ts";
import type { Report } from "./report.ts";
import { decodeReport, parseReport } from "./report.ts";
import type { DocumentStore, StoredDocument } from "./store.ts";
import { documentStore } from "./store.ts";

let opened: DocumentStore | undefined;

function store(): DocumentStore {
	opened ??= documentStore();
	return opened;
}

export async function listDocuments(): Promise<StoredDocument[]> {
	return await store().list();
}

function kindOf(raw: unknown): string | null {
	const held = (raw as { kind?: unknown } | null)?.kind;
	return typeof held === "string" ? held : null;
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
		if (kind !== "health")
			return {
				file,
				ok: false,
				why: `${kind ?? "untyped"} document, not a health report`,
			};
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

export async function newestCrapName(): Promise<string | null> {
	const stored = (await listDocuments())
		.filter((row) => row.name.startsWith(CRAP_PREFIX))
		.sort((a, b) => b.modifiedAt - a.modifiedAt);
	return stored[0]?.name ?? null;
}

export async function readCrap(): Promise<Crap | null> {
	const names = (await listDocuments())
		.map((row) => row.name)
		.filter((name) => name.startsWith(CRAP_PREFIX));
	const raws = await Promise.all(names.map(readDocument));
	return crapOf(
		raws
			.map(crapPointFrom)
			.filter((point): point is CrapPoint => point !== null),
	);
}
