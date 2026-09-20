import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Block } from "./blocks.ts";
import type { Evidence, MentionKind } from "./drift.ts";

const SYMLINK = "120000";
const ENTRIES = 40;
const SAMPLES = 6;
const COMMON = 30;
const BROAD = 0.2;

let top: string | undefined;

function root(): string {
	if (top === undefined)
		top = execFileSync("git", ["rev-parse", "--show-toplevel"], {
			encoding: "utf8",
		}).trim();
	return top;
}

function git(...args: string[]): string {
	return execFileSync("git", args, {
		encoding: "utf8",
		cwd: root(),
		maxBuffer: 64 << 20,
	});
}

export function read(file: string): string {
	return readFileSync(join(root(), file), "utf8");
}

let cache: string[] | undefined;
let reach: string[] | undefined;

function tracked(): string[] {
	if (cache === undefined)
		cache = git("ls-files")
			.split("\n")
			.filter((file) => file !== "");
	return cache;
}

function paths(): string[] {
	if (reach === undefined) {
		const all = new Set(tracked());
		for (const file of tracked()) {
			const parts = file.split("/");
			for (let depth = 1; depth < parts.length; depth++)
				all.add(parts.slice(0, depth).join("/"));
		}
		reach = [...all];
	}
	return reach;
}

export function charterFiles(): string[] {
	return git(
		"ls-files",
		"-s",
		"AGENTS.md",
		"*/AGENTS.md",
		"CLAUDE.md",
		"*/CLAUDE.md",
	)
		.split("\n")
		.filter((line) => line !== "" && !line.startsWith(SYMLINK))
		.map((line) => line.split("\t")[1])
		.filter((file) => file !== undefined);
}

export function changedFiles(base: string): string[] {
	return git("diff", "--name-only", base, "HEAD")
		.split("\n")
		.filter((file) => file !== "");
}

export function addedLines(base: string, file: string): Set<number> {
	const added = new Set<number>();
	const diff = git("diff", "--unified=0", base, "HEAD", "--", file);
	for (const line of diff.split("\n")) {
		const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
		if (hunk === null) continue;
		const from = Number(hunk[1]);
		const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
		for (let n = from; n < from + count; n++) added.add(n);
	}
	return added;
}

export function touched(block: Block, added: ReadonlySet<number>): boolean {
	const span = block.text.split("\n").length;
	for (let n = block.line; n < block.line + span; n++)
		if (added.has(n)) return true;
	return false;
}

export function affects(
	evidence: readonly string[],
	changed: ReadonlySet<string>,
): boolean {
	for (const file of changed)
		for (const entry of evidence)
			if (file === entry || file.startsWith(`${entry}/`)) return true;
	return false;
}

function escaped(pattern: string): RegExp {
	const body = pattern
		.split("*")
		.map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
		.join("[^/]*")
		.replace(/\[\^\/\]\*\[\^\/\]\*/g, ".*");
	return new RegExp(`^${body}$`);
}

function matches(pattern: string): string[] {
	const trimmed = pattern.replace(/\/$/, "");
	const re = escaped(trimmed.includes("/") ? trimmed : `**/${trimmed}`);
	return paths().filter((file) => re.test(file));
}

function shape(token: string): string {
	const bare = token.replace(/<[^>]*>/g, "*").replace(/\/$/, "");
	return /^[*.-]/.test(bare) ? `**/*${bare.replace(/^\*/, "")}` : bare;
}

function listing(path: string): string {
	if (!existsSync(join(root(), path))) return "does not exist";
	if (!statSync(join(root(), path)).isDirectory()) return "exists as a file";
	const entries = readdirSync(join(root(), path)).filter(
		(name) => name !== "node_modules",
	);
	return `a directory holding: ${entries.slice(0, ENTRIES).join(", ")}`;
}

function manifests(): { file: string; name: string }[] {
	return tracked()
		.filter((file) => /^(packages|apps)\/[^/]+\/package\.json$/.test(file))
		.map((file) => ({
			file,
			name: (JSON.parse(read(file)) as { name?: string }).name ?? "",
		}));
}

function packaged(token: string): string {
	const found = manifests().find((one) => one.name === token);
	if (found === undefined)
		return `no package.json in the workspace is named ${token}`;
	const pkg = JSON.parse(read(found.file)) as {
		dependencies?: Record<string, string>;
		exports?: Record<string, string>;
		scripts?: Record<string, string>;
	};
	return [
		`declared in ${found.file}`,
		`dependencies: ${Object.keys(pkg.dependencies ?? {}).join(", ") || "none"}`,
		`exports: ${Object.keys(pkg.exports ?? {}).join(", ") || "none"}`,
		`scripts: ${Object.keys(pkg.scripts ?? {}).join(", ") || "none"}`,
		`source files: ${matches(`${join(found.file, "..")}/src/**`).length}`,
	].join("; ");
}

function grepped(token: string): string[] {
	try {
		return git("grep", "-l", "--fixed-strings", "--", token)
			.split("\n")
			.filter((file) => file !== "" && !file.endsWith(".md"));
	} catch {
		return [];
	}
}

function symbol(token: string): string {
	const hits = grepped(token);
	if (hits.length === 0)
		return `no file in the repository contains the text ${token}`;
	return `${hits.length} file(s) contain it, including: ${hits.slice(0, SAMPLES).join(", ")}`;
}

function scripts(): Record<string, string> {
	return (
		(
			JSON.parse(read("package.json")) as {
				scripts?: Record<string, string>;
			}
		).scripts ?? {}
	);
}

function commanded(token: string): string {
	const words = token.trim().split(/\s+/);
	if (words[0] !== "pnpm") return `not a pnpm invocation; ${symbol(token)}`;
	const named = words.slice(1).filter((word) => !word.startsWith("-"));
	const defined = scripts();
	const hit = named.find((word) => word in defined);
	if (hit !== undefined)
		return `package.json defines the script "${hit}" as: ${defined[hit]}`;
	return `the root package.json defines no script among ${named.join(", ")}; it defines ${Object.keys(defined).join(", ")}`;
}

function globbed(token: string): string {
	const hits = matches(shape(token));
	if (hits.length === 0) return `nothing tracked matches the pattern ${token}`;
	return `${hits.length} tracked file(s) match, including: ${hits.slice(0, SAMPLES).join(", ")}`;
}

function forbidden(token: string): string {
	const hits = [
		...new Set([
			...matches(shape(token)),
			...(existsSync(join(root(), token)) ? [token] : []),
		]),
	];
	if (hits.length === 0)
		return `nothing in the repository matches ${token}, so the prohibition holds`;
	return `the repository DOES contain ${hits.length} match(es), breaking the prohibition: ${hits.slice(0, SAMPLES).join(", ")}`;
}

export function resolve(
	token: string,
	kinds: readonly MentionKind[],
): Evidence[] {
	const found: Evidence[] = [];
	for (const kind of kinds) {
		if (kind === "none") continue;
		if (kind === "path") found.push({ token, kind, found: listing(token) });
		if (kind === "glob" || kind === "convention")
			found.push({ token, kind, found: globbed(token) });
		if (kind === "package") found.push({ token, kind, found: packaged(token) });
		if (kind === "symbol") found.push({ token, kind, found: symbol(token) });
		if (kind === "command")
			found.push({ token, kind, found: commanded(token) });
		if (kind === "prohibition")
			found.push({ token, kind, found: forbidden(token) });
	}
	return found;
}

function covers(entries: readonly string[]): number {
	return tracked().filter((file) =>
		entries.some((entry) => file === entry || file.startsWith(`${entry}/`)),
	).length;
}

export function guess(token: string): string[] {
	const found = new Set<string>();
	const bare = token.replace(/\/$/, "");
	if (bare !== "" && existsSync(join(root(), bare))) found.add(bare);
	for (const file of matches(shape(token))) found.add(file);
	const named = manifests().find((one) => one.name === token);
	if (named !== undefined) found.add(join(named.file, ".."));
	if (found.size === 0 && /^[\w@/.:-]+$/.test(token) && token.length >= 4) {
		const hits = grepped(token);
		if (hits.length <= COMMON) for (const file of hits) found.add(file);
	}
	const list = [...found];
	return covers(list) > tracked().length * BROAD ? [] : list;
}

export function flag(name: string, fallback: string): string {
	const at = process.argv.indexOf(`--${name}`);
	return at === -1 ? fallback : (process.argv[at + 1] ?? fallback);
}

export function has(name: string): boolean {
	return process.argv.includes(`--${name}`);
}

export function annotate(
	level: "error" | "warning" | "notice",
	file: string,
	line: number,
	title: string,
	message: string,
): void {
	const body = message.replace(/\n/g, "%0A").replace(/\r/g, "");
	console.log(`::${level} file=${file},line=${line},title=${title}::${body}`);
}
