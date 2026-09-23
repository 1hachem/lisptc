import { z } from "zod";
import { decodeReport } from "./report.ts";
import type { Snapshot } from "./snapshot.ts";
import { snapshot } from "./snapshot.ts";
import { documentStore } from "./store.ts";

const KIND = "dashi-snapshot";
const PREFIX = "snapshot-";

const trend = z.enum(["accelerating", "stable", "cooling"]);
const nullableNumber = z.number().nullable();

const fileSchema = z.object({
	path: z.string(),
	pkg: z.string(),
	isTest: z.boolean(),
	commits: z.number(),
	added: z.number(),
	deleted: z.number(),
	first: z.string(),
	last: z.string(),
	trend,
	tracked: z.boolean(),
	loc: nullableNumber,
	totCx: nullableNumber,
	maxCx: nullableNumber,
	fns: nullableNumber,
	fanIn: nullableNumber,
	score: nullableNumber,
});

const seriesSchema = z.object({
	key: z.string(),
	counts: z.array(z.number()),
	churn: z.array(z.number()),
});

const pairSchema = z.object({
	a: z.string(),
	b: z.string(),
	together: z.number(),
	aCommits: z.number(),
	bCommits: z.number(),
	strength: z.number(),
});

export const storedSchema = z.object({
	kind: z.literal(KIND),
	generated: z.number(),
	head: z.string(),
	commits: z.number(),
	authors: z.number(),
	layers: z.array(z.string()),
	nodes: z.array(
		z.object({
			id: z.string(),
			dir: z.string(),
			tag: z.string(),
			deps: z.array(z.string()),
		}),
	),
	edges: z.array(
		z.object({ from: z.string(), to: z.string(), violates: z.boolean() }),
	),
	files: z.array(fileSchema),
	functions: z.array(
		z.object({
			file: z.string(),
			name: z.string(),
			line: z.number(),
			complexity: z.number(),
			cognitive: nullableNumber,
			loc: nullableNumber,
			crap: nullableNumber,
			severity: z.string().nullable(),
		}),
	),
	timeline: z.object({
		weeks: z.array(z.string()),
		packages: z.array(seriesSchema),
		files: z.array(seriesSchema),
	}),
	cochange: z.object({
		files: z.array(pairSchema),
		packages: z.array(pairSchema),
	}),
	cycles: z.array(
		z.object({ members: z.array(z.string()), length: z.number() }),
	),
	report: z.string().nullable(),
	analysedFunctions: nullableNumber,
});

export interface Version {
	file: string;
	takenAt: number;
	head: string;
}

function nameOf(view: Snapshot): string {
	const stamp = new Date(view.generated).toISOString().replace(/[:.]/g, "-");
	return `${PREFIX}${stamp}-${view.head.slice(0, 7)}.json`;
}

function parseName(file: string): Version | null {
	const rest = file.slice(PREFIX.length, -".json".length);
	const cut = rest.lastIndexOf("-");
	if (!file.startsWith(PREFIX) || cut < 0) return null;
	const stamp = rest.slice(0, cut);
	const head = rest.slice(cut + 1);
	const iso = `${stamp.slice(0, 10)}T${stamp.slice(11, 19).replaceAll("-", ":")}Z`;
	const takenAt = Date.parse(iso);
	return Number.isNaN(takenAt) ? null : { file, takenAt, head };
}

export async function saveVersion(): Promise<Version> {
	const view = await snapshot();
	const file = nameOf(view);
	await documentStore().write(
		file,
		`${JSON.stringify({ kind: KIND, ...view }, null, 2)}\n`,
	);
	return { file, takenAt: view.generated, head: view.head };
}

export async function listVersions(): Promise<Version[]> {
	const stored = await documentStore().list();
	return stored
		.map((row) => parseName(row.name))
		.filter((version): version is Version => version !== null)
		.sort((a, b) => b.takenAt - a.takenAt);
}

export async function removeVersion(file: string): Promise<void> {
	if (parseName(file) === null)
		throw new Error(`${file} is not a stored version`);
	await documentStore().remove(file);
}

export async function readVersion(file: string): Promise<Snapshot | null> {
	if (file.includes("/") || file.includes("..")) return null;
	try {
		const parsed = storedSchema.safeParse(
			decodeReport(await documentStore().read(file)),
		);
		return parsed.success ? (parsed.data as Snapshot) : null;
	} catch {
		return null;
	}
}
