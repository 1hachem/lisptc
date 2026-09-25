import { z } from "zod";
import type { Pull } from "./forge.ts";
import { forge, pullLimit } from "./forge.ts";
import type { Churn } from "./git.ts";
import { readChurn, weekOf } from "./git.ts";
import { decodeReport } from "./report.ts";
import { listDocuments } from "./reports.ts";
import { documentStore } from "./store.ts";
import type { Tree, Workspace } from "./workspaces.ts";
import { readTree } from "./workspaces.ts";

const KIND = "dashi-pulls";
const PREFIX = "pulls-";
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

const state = z.enum(["open", "merged", "closed"]);
const nullableNumber = z.number().nullable();

const commitSchema = z.object({
	sha: z.string(),
	at: z.string(),
	headline: z.string(),
	added: nullableNumber,
	deleted: nullableNumber,
});

const rowSchema = z.object({
	number: z.number(),
	title: z.string(),
	author: z.string(),
	url: z.string(),
	state,
	draft: z.boolean(),
	openedAt: z.string(),
	closedAt: z.string().nullable(),
	mergedAt: z.string().nullable(),
	added: z.number(),
	deleted: z.number(),
	changed: z.number(),
	hours: nullableNumber,
	commits: z.array(commitSchema),
	touched: z.array(z.string()),
	downstream: z.array(z.string()),
	blastFiles: z.number(),
	reach: z.number(),
});

const flowSchema = z.object({
	weeks: z.array(z.string()),
	opened: z.array(z.number()),
	merged: z.array(z.number()),
	closed: z.array(z.number()),
	open: z.array(z.number()),
});

const storedSchema = z.object({
	kind: z.literal(KIND),
	generated: z.number(),
	head: z.string(),
	forge: z.string(),
	workspaces: z.number(),
	flow: flowSchema,
	rows: z.array(rowSchema),
});

export type PullRow = z.infer<typeof rowSchema>;
export type PullFlow = z.infer<typeof flowSchema>;
export type Pulls = Omit<z.infer<typeof storedSchema>, "kind">;

function weeksBetween(first: string, last: string): string[] {
	const out: string[] = [];
	for (
		let at = Date.parse(`${first}T00:00:00Z`);
		at <= Date.parse(`${last}T00:00:00Z`);
		at += WEEK_MS
	)
		out.push(new Date(at).toISOString().slice(0, 10));
	return out;
}

function day(stamp: string): string {
	return stamp.slice(0, 10);
}

function endOf(week: string): number {
	return Date.parse(`${week}T00:00:00Z`) + WEEK_MS;
}

function flowOf(pulls: Pull[]): PullFlow {
	const opens = pulls.map((pull) => weekOf(day(pull.openedAt))).sort();
	const first = opens[0] ?? weekOf(new Date().toISOString().slice(0, 10));
	const weeks = weeksBetween(
		first,
		weekOf(new Date().toISOString().slice(0, 10)),
	);
	const at = new Map(weeks.map((week, index) => [week, index]));
	const blank = (): number[] => weeks.map(() => 0);
	const flow: PullFlow = {
		weeks,
		opened: blank(),
		merged: blank(),
		closed: blank(),
		open: blank(),
	};

	const bump = (into: number[], stamp: string): void => {
		const index = at.get(weekOf(day(stamp)));
		if (index !== undefined) into[index] = (into[index] ?? 0) + 1;
	};

	for (const pull of pulls) {
		bump(flow.opened, pull.openedAt);
		if (pull.mergedAt !== null) bump(flow.merged, pull.mergedAt);
		else if (pull.closedAt !== null) bump(flow.closed, pull.closedAt);
	}

	weeks.forEach((week, index) => {
		const edge = endOf(week);
		flow.open[index] = pulls.filter((pull) => {
			if (Date.parse(pull.openedAt) >= edge) return false;
			return pull.closedAt === null || Date.parse(pull.closedAt) >= edge;
		}).length;
	});

	return flow;
}

function dependentsOf(nodes: Workspace[]): Map<string, string[]> {
	const known = new Set(nodes.map((node) => node.id));
	const dependents = new Map<string, string[]>();
	for (const node of nodes)
		for (const dep of node.deps) {
			if (!known.has(dep)) continue;
			const held = dependents.get(dep);
			if (held === undefined) dependents.set(dep, [node.id]);
			else held.push(node.id);
		}
	return dependents;
}

function ownerOf(nodes: Workspace[]): (path: string) => string | null {
	const dirs = [...nodes].sort((a, b) => b.dir.length - a.dir.length);
	return (path) =>
		dirs.find((node) => path.startsWith(`${node.dir}/`))?.id ?? null;
}

function filesPerWorkspace(tree: Tree): Map<string, number> {
	const owner = ownerOf(tree.nodes);
	const counts = new Map<string, number>();
	for (const path of Object.keys(tree.sizes)) {
		const id = owner(path);
		if (id === null) continue;
		counts.set(id, (counts.get(id) ?? 0) + 1);
	}
	return counts;
}

function closure(seeds: string[], dependents: Map<string, string[]>): string[] {
	const seen = new Set(seeds);
	const queue = [...seeds];
	const out: string[] = [];
	while (queue.length > 0) {
		const id = queue.shift();
		if (id === undefined) continue;
		for (const up of dependents.get(id) ?? []) {
			if (seen.has(up)) continue;
			seen.add(up);
			out.push(up);
			queue.push(up);
		}
	}
	return out.sort();
}

function hoursOf(pull: Pull): number | null {
	const end = pull.mergedAt ?? pull.closedAt;
	if (end === null) return null;
	return Number(
		((Date.parse(end) - Date.parse(pull.openedAt)) / HOUR_MS).toFixed(1),
	);
}

function rowOf(
	pull: Pull,
	tree: Tree,
	churn: Map<string, Churn>,
	dependents: Map<string, string[]>,
	sizes: Map<string, number>,
): PullRow {
	const owner = ownerOf(tree.nodes);
	const touched = [
		...new Set(
			pull.files
				.map((file) => owner(file.path))
				.filter((id): id is string => id !== null),
		),
	].sort();
	const downstream = closure(touched, dependents);
	const blastFiles = [...touched, ...downstream].reduce(
		(sum, id) => sum + (sizes.get(id) ?? 0),
		0,
	);

	return {
		number: pull.number,
		title: pull.title,
		author: pull.author,
		url: pull.url,
		state: pull.state,
		draft: pull.draft,
		openedAt: pull.openedAt,
		closedAt: pull.closedAt,
		mergedAt: pull.mergedAt,
		added: pull.added,
		deleted: pull.deleted,
		changed: pull.changed,
		hours: hoursOf(pull),
		commits: [...pull.commits]
			.sort((a, b) => a.at.localeCompare(b.at))
			.map((commit) => ({
				sha: commit.sha,
				at: commit.at,
				headline: commit.headline,
				added: churn.get(commit.sha)?.added ?? null,
				deleted: churn.get(commit.sha)?.deleted ?? null,
			})),
		touched,
		downstream,
		blastFiles,
		reach:
			tree.nodes.length === 0
				? 0
				: Number(
						((touched.length + downstream.length) / tree.nodes.length).toFixed(
							3,
						),
					),
	};
}

async function composePulls(head: string): Promise<Pulls> {
	const reader = forge();
	const [pulls, tree, churn] = await Promise.all([
		reader.pulls(pullLimit()),
		readTree(),
		readChurn(),
	]);
	const dependents = dependentsOf(tree.nodes);
	const sizes = filesPerWorkspace(tree);

	return {
		generated: Date.now(),
		head,
		forge: reader.describe(),
		workspaces: tree.nodes.length,
		flow: flowOf(pulls),
		rows: pulls
			.map((pull) => rowOf(pull, tree, churn, dependents, sizes))
			.sort((a, b) => b.number - a.number),
	};
}

function nameOf(view: Pulls): string {
	const stamp = new Date(view.generated).toISOString().replace(/[:.]/g, "-");
	return `${PREFIX}${stamp}.json`;
}

export async function savePulls(head: string): Promise<{ file: string }> {
	const view = await composePulls(head);
	const file = nameOf(view);
	await documentStore().write(
		file,
		`${JSON.stringify({ kind: KIND, ...view }, null, 2)}\n`,
	);
	return { file };
}

export async function readPulls(): Promise<Pulls | null> {
	const stored = [...(await listDocuments())]
		.filter((row) => row.name.startsWith(PREFIX))
		.sort((a, b) => b.modifiedAt - a.modifiedAt);
	for (const row of stored) {
		try {
			const parsed = storedSchema.safeParse(
				decodeReport(await documentStore().read(row.name)),
			);
			if (parsed.success) return parsed.data;
		} catch {}
	}
	return null;
}
