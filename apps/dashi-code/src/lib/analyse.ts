import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { exec, repoRoot } from "./repo.ts";
import { documentStore } from "./store.ts";
import { saveVersion } from "./versions.ts";

const CAPTURES = ".coverage";
const KEPT = 12;

export interface Analysis {
	at: number;
	wrote: string[];
	failed: { what: string; why: string }[];
}

let running: Promise<Analysis> | null = null;

export function analyse(): Promise<Analysis> {
	running ??= perform().finally(() => {
		running = null;
	});
	return running;
}

async function capture(): Promise<string | null> {
	try {
		const found = await readdir(join(repoRoot(), CAPTURES));
		const rebased = found
			.filter((name) => name.endsWith("-rebased.json"))
			.sort()
			.at(-1);
		return rebased === undefined ? null : join(CAPTURES, rebased);
	} catch {
		return null;
	}
}

async function write(name: string, body: string): Promise<void> {
	await documentStore().write(name, body.endsWith("\n") ? body : `${body}\n`);
}

async function perform(): Promise<Analysis> {
	const at = Date.now();
	const stamp = Math.floor(at / 1000);
	const wrote: string[] = [];
	const failed: { what: string; why: string }[] = [];

	const attempt = async (what: string, run: () => Promise<string>) => {
		try {
			wrote.push(await run());
		} catch (err) {
			failed.push({
				what,
				why: err instanceof Error ? err.message.slice(0, 400) : String(err),
			});
		}
	};

	await attempt("dead-code", async () => {
		const { stdout } = await exec("pnpm", [
			"exec",
			"fallow",
			"dead-code",
			"--type-aware",
			"--format",
			"json",
			"--quiet",
		]);
		const name = `deadcode-${stamp}.json`;
		await write(name, stdout);
		return name;
	});

	await attempt("health", async () => {
		const dump = await capture();
		const { stdout } = await exec("pnpm", [
			"exec",
			"fallow",
			"health",
			...(dump === null ? [] : ["--runtime-coverage", dump]),
			"--format",
			"json",
			"--quiet",
		]);
		const name = `health-${stamp}.json`;
		await write(name, stdout);
		return name;
	});

	await attempt("version", async () => (await saveVersion()).file);
	await prune();

	return { at, wrote, failed };
}

async function prune(): Promise<void> {
	const store = documentStore();
	const stored = await store.list();
	const groups = new Map<string, typeof stored>();
	for (const row of stored) {
		const prefix = /^(deadcode|health|snapshot)-/.exec(row.name)?.[1];
		if (prefix === undefined) continue;
		const held = groups.get(prefix);
		if (held === undefined) groups.set(prefix, [row]);
		else held.push(row);
	}
	for (const rows of groups.values())
		for (const row of rows
			.sort((a, b) => b.modifiedAt - a.modifiedAt)
			.slice(KEPT))
			await store.remove?.(row.name);
}
