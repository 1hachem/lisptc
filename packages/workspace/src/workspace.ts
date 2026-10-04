import { driveAsync, type Eval, settled } from "@repo/interpreter/drive";
import { EvalException } from "@repo/interpreter/errors";
import { type Interp, runGen } from "@repo/interpreter/lisp";
import { arrayToList, type Cell, Sym } from "@repo/interpreter/objects";
import type { InterpExtension, SessionHooks } from "@repo/interpreter/session";
import { z } from "zod";
import {
	definedName,
	formatDefinition,
	LOAD_ORDER,
	procedurePath,
	TRACKED_DIRS,
	type WorkspaceFiles,
	type WorkspaceHistory,
	type WorkspaceHost,
} from "./ports.ts";

export class Workspace {
	private readonly definitions = new WeakMap<Interp, Map<string, Cell>>();
	private readonly loaded = new WeakMap<Interp, readonly string[]>();
	private readonly changed = new Set<string>();
	private readonly actions: string[] = [];

	constructor(
		readonly files: WorkspaceFiles,
		readonly history?: WorkspaceHistory,
	) {}

	record(interp: Interp, form: unknown): void {
		const name = definedName(form);
		if (name === undefined) return;
		let byName = this.definitions.get(interp);
		if (byName === undefined) {
			byName = new Map();
			this.definitions.set(interp, byName);
		}
		byName.set(name, form as Cell);
	}

	*sources(): Eval<string[]> {
		const out: string[] = [];
		for (const entry of LOAD_ORDER) {
			if (entry.endsWith(".ptc")) {
				out.push(entry);
				continue;
			}
			const listed = yield* settled(this.files.list(entry));
			out.push(...listed.filter((p) => p.endsWith(".ptc")).sort());
		}
		return out;
	}

	*load(interp: Interp): Eval<readonly string[]> {
		const done = this.loaded.get(interp);
		if (done !== undefined) return [];
		this.loaded.set(interp, []);
		const failures: string[] = [];
		for (const path of yield* this.sources()) {
			const text = yield* settled(this.files.read(path));
			if (text === undefined || text.trim() === "") continue;
			try {
				yield* runGen(interp, text);
			} catch (ex) {
				if (!(ex instanceof EvalException)) throw ex;
				failures.push(`${path}: ${ex.message}`);
			}
		}
		this.loaded.set(interp, failures);
		return failures;
	}

	*save(interp: Interp, name: string): Eval<string> {
		const form = this.definitions.get(interp)?.get(name);
		if (form === undefined)
			throw new EvalException(
				"no defun or defmacro of this name was evaluated in this session; define it first",
				name,
				false,
			);
		const path = procedurePath(name);
		yield* settled(this.files.write(path, formatDefinition(form)));
		this.touch(path, `save ${name}`);
		return path;
	}

	*drop(name: string): Eval<boolean> {
		const path = procedurePath(name);
		const removed = yield* settled(this.files.remove(path));
		if (removed) this.touch(path, `drop ${name}`);
		return removed;
	}

	private touch(path: string, action: string): void {
		this.changed.add(path);
		this.actions.push(action);
	}

	async commit(): Promise<void> {
		const paths = [...this.changed, ...TRACKED_DIRS];
		const message =
			this.actions.length === 0
				? `update ${TRACKED_DIRS.join(", ")}`
				: this.actions.join(", ");
		this.changed.clear();
		this.actions.length = 0;
		await this.history?.commit(message, paths);
	}
}

function loadReport(failures: readonly string[]): string {
	return [
		"<workspace>",
		"these workspace files failed to load; what they define is missing until they are fixed:",
		...failures,
		"</workspace>",
	].join("\n");
}

function workspaceSession(ws: Workspace): (hooks: SessionHooks) => void {
	return (hooks) => {
		hooks.system.use(function* (interp, prompt, next) {
			const failures = yield* ws.load(interp);
			return yield* next(
				interp,
				failures.length === 0 ? prompt : `${prompt}\n\n${loadReport(failures)}`,
			);
		});
		hooks.evalStep.use(async (ctx, next) => {
			const failures = (await driveAsync(ws.load(ctx.interp))).value;
			if (failures.length > 0) ctx.emit(`${loadReport(failures)}\n`);
			try {
				await next(ctx);
			} finally {
				await ws.commit();
			}
		});
	};
}

export interface WorkspaceExtension extends InterpExtension {
	readonly workspace: Workspace;
}

export function workspaceExtension(host: WorkspaceHost): WorkspaceExtension {
	const ws = new Workspace(host.files, host.history);
	return Object.assign(
		(interp: Interp): void => registerWorkspace(interp, ws),
		{
			workspace: ws,
			prompt: host.prompt(),
			session: workspaceSession(ws),
		},
	);
}

function nameOf(value: unknown): string {
	if (value instanceof Sym) return value.name;
	if (typeof value === "string") return value;
	throw new EvalException("a procedure name is a symbol: write 'name", value);
}

export function registerWorkspace(interp: Interp, ws: Workspace): void {
	interp.hooks.evalForm.use(function* (i, form, next): Eval {
		const value = yield* next(i, form);
		ws.record(i, form);
		return value;
	});

	interp.defGen(
		"proc/save",
		1,
		"(proc/save 'name)",
		"Save the defun or defmacro you last evaluated under `name` to the workspace, as procedures/name.ptc. It loads by itself in every later session, and the user can read and edit it. Returns the file's path.",
		z.tuple([z.unknown()]),
		function* ([name]): Eval {
			return yield* ws.save(interp, nameOf(name));
		},
	);

	interp.defGen(
		"proc/drop",
		1,
		"(proc/drop 'name)",
		"Delete a saved procedure's file from the workspace, so later sessions no longer load it. This session keeps its definition. Returns t if there was one.",
		z.tuple([z.unknown()]),
		function* ([name]): Eval {
			return (yield* ws.drop(nameOf(name))) || null;
		},
	);

	interp.defGen(
		"ws/files",
		0,
		"(ws/files)",
		"List the workspace files that load at session start, in the order they load.",
		z.tuple([]),
		function* (): Eval {
			return arrayToList(yield* ws.sources());
		},
	);
}
