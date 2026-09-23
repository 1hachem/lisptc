import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { git, repoRoot } from "./repo.ts";

export interface Workspace {
	id: string;
	dir: string;
	tag: string;
	deps: string[];
}

export interface Edge {
	from: string;
	to: string;
	violates: boolean;
}

export interface Tree {
	layers: string[];
	deny: Record<string, string[]>;
	nodes: Workspace[];
	edges: Edge[];
	sizes: Record<string, number>;
}

const CODE = /\.(ts|tsx|js|jsx|mjs|cjs|css)$/;

async function json(path: string): Promise<Record<string, unknown> | null> {
	try {
		return JSON.parse(await readFile(join(repoRoot(), path), "utf8"));
	} catch {
		return null;
	}
}

function stringsOf(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((v): v is string => typeof v === "string")
		: [];
}

async function denyRules(): Promise<{
	layers: string[];
	deny: Record<string, string[]>;
}> {
	const root = await json("turbo.json");
	const boundaries = (root?.boundaries ?? {}) as {
		tags?: Record<string, unknown>;
	};
	const deny: Record<string, string[]> = {};
	for (const [tag, rule] of Object.entries(boundaries.tags ?? {})) {
		const dependencies = (rule as { dependencies?: { deny?: unknown } })
			.dependencies;
		deny[tag] = stringsOf(dependencies?.deny);
	}
	return { layers: Object.keys(deny), deny };
}

async function tagOf(dir: string): Promise<string> {
	const config = await json(join(dir, "turbo.json"));
	return stringsOf(config?.tags)[0] ?? "untagged";
}

export async function readTree(): Promise<Tree> {
	const tracked = pathsOf(await git(["ls-files"]));
	const [nodes, { layers, deny }] = await Promise.all([
		workspacesOf(tracked),
		denyRules(),
	]);
	return {
		layers,
		deny,
		nodes,
		edges: edgesOf(nodes, deny),
		sizes: await sizesOf(tracked),
	};
}

function pathsOf(raw: string): string[] {
	return raw.split("\n").filter((path) => path !== "");
}

async function workspacesOf(tracked: string[]): Promise<Workspace[]> {
	const manifests = tracked.filter(
		(path) =>
			path.endsWith("/package.json") &&
			/^(packages|apps)\/[^/]+\/package\.json$/.test(path),
	);
	const nodes = await Promise.all(manifests.map(workspaceOf));
	return nodes.filter((node): node is Workspace => node !== null);
}

async function workspaceOf(manifest: string): Promise<Workspace | null> {
	const dir = manifest.slice(0, -"/package.json".length);
	const held = await json(manifest);
	if (held === null || typeof held.name !== "string") return null;
	const declared = {
		...((held.dependencies ?? {}) as Record<string, string>),
		...((held.devDependencies ?? {}) as Record<string, string>),
	};
	return {
		id: held.name,
		dir,
		tag: await tagOf(dir),
		deps: Object.entries(declared)
			.filter(([, range]) => range.startsWith("workspace:"))
			.map(([name]) => name),
	};
}

function edgesOf(nodes: Workspace[], deny: Record<string, string[]>): Edge[] {
	const known = new Map(nodes.map((node) => [node.id, node]));
	return nodes.flatMap((node) =>
		node.deps.flatMap((dep) => {
			const target = known.get(dep);
			return target === undefined
				? []
				: [
						{
							from: node.id,
							to: dep,
							violates: (deny[node.tag] ?? []).includes(target.tag),
						},
					];
		}),
	);
}

async function sizesOf(tracked: string[]): Promise<Record<string, number>> {
	const code = tracked.filter(
		(path) => CODE.test(path) && !path.includes("/_generated/"),
	);
	const sizes: Record<string, number> = {};
	await Promise.all(
		code.map(async (path) => {
			try {
				const body = await readFile(join(repoRoot(), path), "utf8");
				sizes[path] = body === "" ? 0 : body.split("\n").length;
			} catch {}
		}),
	);
	return sizes;
}
