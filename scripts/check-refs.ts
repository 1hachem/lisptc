import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

const EXTENSIONS =
	/\.(ts|tsx|js|jsx|mjs|cjs|json|md|css|sh|yml|yaml|lua|toml|nix|ptc|scm)$/;

const RUNNERS = new Set(["pnpm", "turbo", "task", "npx"]);

type Kind = "path" | "command" | "identifier";

type Span = {
	file: string;
	line: number;
	token: string;
};

type Ref = Span & {
	kind: Kind;
	needle: string;
	namespace: "script" | "task" | "either" | "";
};

type Offender = Ref & { tried: string[] };

function git(args: string[]): string {
	return execFileSync("git", args, { encoding: "utf8", maxBuffer: 1 << 26 });
}

function argValue(flag: string, fallback: string): string {
	const at = process.argv.indexOf(flag);
	return at === -1 ? fallback : (process.argv[at + 1] ?? fallback);
}

function agentsFiles(out: string): string[] {
	return out
		.split("\n")
		.filter(Boolean)
		.filter((file) => basename(file) === "AGENTS.md");
}

function trackedFiles(): string[] {
	return agentsFiles(git(["ls-files", "--", "*AGENTS.md"]));
}

function changedFiles(base: string): string[] {
	return agentsFiles(
		git(["diff", "--name-only", "--diff-filter=d", base, "--", "*AGENTS.md"]),
	);
}

function addedLineNumbers(base: string, file: string): Set<number> {
	const out = git(["diff", "--unified=0", base, "--", file]);
	const added = new Set<number>();
	let cursor = 0;
	for (const line of out.split("\n")) {
		const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
		if (hunk?.[1]) {
			cursor = Number(hunk[1]);
			continue;
		}
		if (line.startsWith("+++")) continue;
		if (line.startsWith("+")) {
			added.add(cursor);
			cursor += 1;
		}
	}
	return added;
}

function scriptNames(): Set<string> {
	const names = new Set<string>();
	for (const manifest of git(["ls-files", "--", "*package.json"])
		.split("\n")
		.filter(Boolean)) {
		try {
			const json = JSON.parse(readFileSync(manifest, "utf8")) as {
				scripts?: Record<string, unknown>;
			};
			for (const name of Object.keys(json.scripts ?? {})) names.add(name);
		} catch {}
	}
	return names;
}

function unquote(value: string): string {
	return value.replace(/^["']|["']$/g, "");
}

function includesOf(
	file: string,
	lines: string[],
	prefix: string,
): { path: string; prefix: string }[] {
	const dir = dirname(file);
	const found: { path: string; prefix: string }[] = [];
	let inIncludes = false;
	let name = "";
	let path = "";
	let flatten = false;

	const flush = () => {
		if (name !== "" && path !== "") {
			found.push({
				path: join(dir, path),
				prefix: flatten ? prefix : `${prefix}${name}:`,
			});
		}
		name = "";
		path = "";
		flatten = false;
	};

	for (const line of lines) {
		if (/^includes:\s*$/.test(line)) {
			inIncludes = true;
			continue;
		}
		if (!inIncludes) continue;
		if (/^\S/.test(line)) break;
		const inline = /^ {2}([A-Za-z0-9_-]+):\s*(\S+)\s*$/.exec(line);
		if (inline?.[1] && inline[2]) {
			flush();
			found.push({
				path: join(dir, unquote(inline[2])),
				prefix: `${prefix}${inline[1]}:`,
			});
			continue;
		}
		const header = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
		if (header?.[1]) {
			flush();
			name = header[1];
			continue;
		}
		const taskfile = /^\s+taskfile:\s*(\S+)\s*$/.exec(line);
		if (taskfile?.[1]) {
			path = unquote(taskfile[1]);
			continue;
		}
		if (/^\s+flatten:\s*true\s*$/.test(line)) flatten = true;
	}
	flush();
	return found;
}

function collectTasks(
	file: string,
	prefix: string,
	names: Set<string>,
	seen: Set<string>,
): void {
	const key = `${prefix}${file}`;
	if (seen.has(key) || !existsSync(file)) return;
	seen.add(key);
	const lines = readFileSync(file, "utf8").split("\n");
	for (const include of includesOf(file, lines, prefix)) {
		collectTasks(include.path, include.prefix, names, seen);
	}

	let inTasks = false;
	let inAliases = false;
	for (const line of lines) {
		if (/^tasks:\s*$/.test(line)) {
			inTasks = true;
			continue;
		}
		if (!inTasks) continue;
		if (/^\S/.test(line)) break;
		const task = /^ {2}([A-Za-z0-9_:.-]+):\s*$/.exec(line);
		if (task?.[1]) {
			names.add(`${prefix}${task[1]}`);
			if (task[1] === "default" && prefix !== "") {
				names.add(prefix.slice(0, -1));
			}
			inAliases = false;
			continue;
		}
		if (/^\s+aliases:\s*$/.test(line)) {
			inAliases = true;
			continue;
		}
		const alias = /^\s+- ([A-Za-z0-9_:.-]+)\s*$/.exec(line);
		if (inAliases && alias?.[1]) {
			names.add(`${prefix}${alias[1]}`);
			continue;
		}
		if (/^\s+\S+:/.test(line)) inAliases = false;
	}
}

function taskNames(): Set<string> {
	const names = new Set<string>();
	collectTasks("Taskfile.yml", "", names, new Set());
	return names;
}

function spansOf(file: string, isNew: (line: number) => boolean): Span[] {
	const lines = readFileSync(file, "utf8").split("\n");
	const spans: Span[] = [];
	let fenced = false;

	lines.forEach((text, index) => {
		const line = index + 1;
		if (/^\s*```/.test(text)) {
			fenced = !fenced;
			return;
		}
		if (fenced || !isNew(line)) return;
		for (const match of text.matchAll(/`([^`]+)`/g)) {
			const span = match[1];
			if (span === undefined) continue;
			spans.push({ file, line, token: span });
		}
	});
	return spans;
}

function clean(token: string): string {
	return token
		.replace(/^["'(]+/, "")
		.replace(/["')]+$/, "")
		.replace(/[,.;:]+$/, "");
}

function skipped(token: string): boolean {
	if (token === "") return true;
	if (token.includes("<") || token.includes("*") || token.includes("=")) {
		return true;
	}
	if (token.startsWith("@") || token.startsWith("/")) return true;
	if (token.startsWith("node:")) return true;
	if (!token.includes("/") && /^[.-]/.test(token)) return true;
	if (/^[A-Z0-9_]+$/.test(token) && token.includes("_")) return true;
	return false;
}

function pathLike(token: string): boolean {
	return token.includes("/") || EXTENSIONS.test(token);
}

function refsOf(span: Span): Ref[] {
	const tokens = span.token.split(/\s+/).map(clean).filter(Boolean);
	const first = tokens[0];
	if (first === undefined) return [];

	if (tokens.length === 1) {
		if (skipped(first)) return [];
		if (pathLike(first)) {
			return [
				{ ...span, token: first, kind: "path", needle: first, namespace: "" },
			];
		}
		if (first.includes(":")) {
			return [
				{
					...span,
					token: first,
					kind: "command",
					needle: first,
					namespace: "either",
				},
			];
		}
		const needle = first.replace(/\(\)/g, "").split(".")[0] ?? "";
		if (needle === "") return [];
		return [
			{ ...span, token: first, kind: "identifier", needle, namespace: "" },
		];
	}

	const refs: Ref[] = [];
	if (RUNNERS.has(first)) {
		const at = first === "turbo" && tokens[1] === "run" ? 2 : 1;
		const name = tokens[at];
		if (name !== undefined && !name.startsWith("-") && !pathLike(name)) {
			refs.push({
				...span,
				token: name,
				kind: "command",
				needle: name,
				namespace: first === "task" ? "task" : "script",
			});
		}
	}
	for (const token of tokens) {
		if (skipped(token) || !pathLike(token)) continue;
		refs.push({ ...span, token, kind: "path", needle: token, namespace: "" });
	}
	return refs;
}

const tracked = git(["ls-files"]).split("\n").filter(Boolean);
const scripts = scriptNames();
const tasks = taskNames();
const identifiers = new Map<string, boolean>();

function names(needle: string): boolean {
	const known = identifiers.get(needle);
	if (known !== undefined) return known;
	let hit = false;
	try {
		execFileSync(
			"git",
			["grep", "-q", "-w", "-F", "--", needle, "--", ":!*.md"],
			{
				stdio: "ignore",
			},
		);
		hit = true;
	} catch {}
	identifiers.set(needle, hit);
	return hit;
}

function tailMatch(needle: string, prefix: string): boolean {
	const tail = `/${needle}`;
	const scope = needle.includes("/") ? prefix : "";
	return tracked.some(
		(file) =>
			file.startsWith(scope) &&
			(file.endsWith(tail) || file.includes(`${tail}/`)),
	);
}

function resolve(ref: Ref): string[] {
	if (ref.kind === "command") {
		const inScripts = scripts.has(ref.needle);
		const inTasks = tasks.has(ref.needle);
		if (ref.namespace === "script" && inScripts) return [];
		if (ref.namespace === "task" && inTasks) return [];
		if (ref.namespace === "either" && (inScripts || inTasks)) return [];
		if (ref.namespace === "task") return ["no such target in Taskfile.yml"];
		if (ref.namespace === "script") {
			return ["no package.json declares the script"];
		}
		return [
			"no package.json declares the script, and Taskfile.yml has no target",
		];
	}

	if (ref.kind === "identifier") {
		if (names(ref.needle)) return [];
		return ["no tracked source file names it"];
	}

	const dir = dirname(ref.file);
	const prefix = dir === "." ? "" : `${dir}/`;
	const needle = ref.needle.replace(/^\.\//, "").replace(/\/+$/, "");
	const local = join(prefix, needle);
	if (existsSync(local)) return [];
	if (existsSync(needle)) return [];
	if (tailMatch(needle, prefix)) return [];
	if (prefix === "") return ["no such path tracked anywhere in the repo"];
	if (needle.includes("/")) {
		return [
			`no such path at ${local} or ${needle}, and none tracked under ${dir}`,
		];
	}
	return [`no file named ${needle} is tracked anywhere in the repo`];
}

const sweep = process.argv.includes("--all");
const base = sweep
	? ""
	: git(["merge-base", argValue("--base", "origin/main"), "HEAD"]).trim();
const files = sweep ? trackedFiles() : changedFiles(base);

if (files.length === 0) {
	console.log(
		sweep ? "No AGENTS.md tracked." : "No AGENTS.md changed. Skipped.",
	);
	process.exit(0);
}

const spans = files.flatMap((file) => {
	if (sweep) return spansOf(file, () => true);
	const added = addedLineNumbers(base, file);
	return spansOf(file, (line) => added.has(line));
});

const refs = spans.flatMap(refsOf);

if (process.argv.includes("--print")) {
	for (const ref of refs) {
		const tried = resolve(ref);
		console.log(
			`${ref.file}:${ref.line}  ${tried.length === 0 ? "ok  " : "DEAD"}  ${ref.kind.padEnd(10)}  ${ref.token}`,
		);
	}
	console.log(`${refs.length} references in ${files.length} AGENTS.md.`);
	process.exit(0);
}

const offenders: Offender[] = [];
for (const ref of refs) {
	const tried = resolve(ref);
	if (tried.length > 0) offenders.push({ ...ref, tried });
}

if (offenders.length === 0) {
	console.log(
		`${refs.length} reference${refs.length === 1 ? "" : "s"} in ${files.length} AGENTS.md, all still resolving.`,
	);
	process.exit(0);
}

for (const offender of offenders) {
	console.error(`${offender.file}:${offender.line}  ${offender.token}`);
	for (const line of offender.tried) console.error(`  ${line}`);
}

console.error("");
console.error(
	`${offenders.length} dead reference${offenders.length === 1 ? "" : "s"} in ${files.length} AGENTS.md.`,
);
console.error("");
console.error(
	"An AGENTS.md points at the code, and the code is the only source",
);
console.error("of truth. A path, a command or a name written here is dead the");
console.error(
	"moment the code moves. Fix the reference, or delete the sentence",
);
console.error("that carries it. Prose that names a thing which must not exist");
console.error("carries no backticks, so it is not read as a reference.");
process.exit(1);
