import { Cell, type List, Sym } from "@repo/interpreter/objects";
import { str } from "@repo/interpreter/print";
import type { Awaitable, PromptSource } from "@repo/shared/host";

export const MANIFEST = "workspace.ptc";
export const MAIN = "main.ptc";
export const PROCEDURES = "procedures";
export const MEMORIES = "memories";
export const TASKS = "tasks";
export const RUNTIME_DIR = ".lisptc";

export const LOAD_ORDER = [PROCEDURES, MAIN] as const;

export const TRACKED_DIRS = [MEMORIES] as const;

export const DEFINING_HEADS = ["defun", "defmacro"] as const;

export interface WorkspaceFiles {
	read(path: string): Awaitable<string | undefined>;
	write(path: string, text: string): Awaitable<void>;
	remove(path: string): Awaitable<boolean>;
	list(dir: string): Awaitable<string[]>;
}

export interface WorkspaceHistory {
	commit(message: string, paths: readonly string[]): Awaitable<void>;
}

export interface WorkspaceHost {
	files: WorkspaceFiles;
	history?: WorkspaceHistory;
	prompt: PromptSource;
}

const SAFE_SEGMENT = /^[a-zA-Z0-9._-]$/;

function encodeSegment(segment: string): string {
	let out = "";
	for (const ch of segment)
		out += SAFE_SEGMENT.test(ch)
			? ch
			: [...new TextEncoder().encode(ch)]
					.map((b) => `%${b.toString(16).toUpperCase().padStart(2, "0")}`)
					.join("");
	return out;
}

export function procedurePath(name: string): string {
	const segments = name.split("/").map(encodeSegment);
	return `${PROCEDURES}/${segments.join("/")}.ptc`;
}

export function definedName(form: unknown): string | undefined {
	if (!(form instanceof Cell) || !(form.car instanceof Sym)) return undefined;
	if (!(DEFINING_HEADS as readonly string[]).includes(form.car.name))
		return undefined;
	const rest = form.cdr;
	if (!(rest instanceof Cell) || !(rest.car instanceof Sym)) return undefined;
	return rest.car.name;
}

export function formatDefinition(form: Cell): string {
	const parts: unknown[] = [];
	for (let p: List = form; p !== null; p = p.cdr as List) parts.push(p.car);
	const [head, name, args, ...body] = parts;
	const lines = [`(${str(head)} ${str(name)} ${str(args)}`];
	for (const item of body) lines.push(`  ${str(item)}`);
	return `${lines.join("\n")})\n`;
}

export function manifestText(name: string): string {
	return `(workspace ${str(name)} :convention 1)\n`;
}

export function scaffold(name: string): Map<string, string> {
	return new Map([
		[MANIFEST, manifestText(name)],
		[MAIN, ""],
		[`${PROCEDURES}/.gitkeep`, ""],
		[`${MEMORIES}/.gitkeep`, ""],
		[`${TASKS}/.gitkeep`, ""],
		[".gitignore", `${RUNTIME_DIR}/\n`],
	]);
}
