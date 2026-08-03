/**
 * Reusable REPL front-ends for the Lisptc interpreter.
 *
 * The interpreter (`@repo/interpreter`) is pure language: `Interp`, `run`,
 * `str`, `prelude`, the reader. A REPL is a driver on top of it. This module
 * hosts the embeddable (string-in / string-out) REPLs; the interactive
 * stdin/stdout loop lives in `./cli.ts`.
 *
 * - `MemoryRepl` — evaluate a program string, return what the interactive REPL
 *   would have printed (last value + side-effect output, errors rendered
 *   inline). No process I/O, so embedders can run Lisp without a subprocess.
 * - `AgentRepl` — `MemoryRepl` plus two things an embedding agent needs:
 *   the `halt` built-in (a REPL feature, not part of the language) and
 *   read-only conversation-state globals refreshed from the host each step.
 */

import { replEnv } from "@repo/env/repl.ts";
import {
	Cell,
	EndOfFile,
	EvalException,
	Interp,
	type List,
	newSym,
	prelude,
	run,
	type SecretSpec,
	setWriter,
	str,
} from "@repo/interpreter/lisp.ts";

// Seed an interp's secret registry from a `.env` file: the path in
// $LISPTC_SECRETS_FILE, or `.env` in the working directory if it exists. Shared
// by every REPL front-end (the CLI and the embeddable AgentRepl) so a `.env`
// works the same everywhere. (REPL_* env vars are seeded by the Interp
// constructor regardless; the file-path var is deliberately not REPL_-prefixed
// so it isn't itself picked up as a secret.) Returns the loaded entries.
export function seedSecretsFromEnvFile(interp: Interp): Record<string, string> {
	const explicit = replEnv.LISPTC_SECRETS_FILE;
	const path = explicit ?? ".env";
	try {
		return interp.loadSecretsFromFile(path);
	} catch {
		// A missing default `.env` is fine; only warn if one was named explicitly.
		if (explicit)
			console.error(`warning: could not read secrets file ${explicit}`);
		return {};
	}
}

// A REPL owns an interpreter and can be reset to a fresh one.
export interface Repl {
	readonly interp: Interp;
	reset(): void;
}

// A REPL driven by strings rather than process I/O.
export interface InMemoryRepl extends Repl {
	eval(code: string): string;
}

// Convert a host JS value into the equivalent Lisp value. Mirrors `jsonToLisp`
// in `./mcp.ts` (kept separate so the interpreter core stays free of it):
// arrays -> proper list; plain objects -> alist of (key . value) with string
// keys; null/undefined/false -> nil; true -> t; numbers/strings pass through.
function jsToLisp(value: unknown): unknown {
	if (value === null || value === undefined) return null;
	if (value === true) return true;
	if (value === false) return null; // Lisp has only nil for falsity
	if (typeof value === "number" || typeof value === "bigint") return value;
	if (typeof value === "string") return value;
	if (Array.isArray(value)) return arrayToList(value.map(jsToLisp));
	if (typeof value === "object") {
		const pairs = Object.entries(value as Record<string, unknown>).map(
			([k, v]) => new Cell(k, jsToLisp(v)),
		);
		return arrayToList(pairs);
	}
	return String(value);
}

function arrayToList(arr: unknown[]): List {
	let out: List = null;
	for (let i = arr.length - 1; i >= 0; i--) out = new Cell(arr[i], out);
	return out;
}

// A persistent in-process REPL: `eval` runs a program and returns what the
// interactive REPL would have printed. State persists across calls.
export class MemoryRepl implements InMemoryRepl {
	private currentInterp: Interp;

	constructor() {
		this.currentInterp = this.freshInterp();
	}

	get interp(): Interp {
		return this.currentInterp;
	}

	private freshInterp(): Interp {
		const interp = new Interp();
		run(interp, prelude);
		this.setup(interp);
		return interp;
	}

	// Hook for subclasses to install extra bindings on a fresh interp. Called
	// during construction and on every `reset()` — before subclass field
	// initializers run on the first call, so overrides must tolerate their own
	// fields still being undefined.
	protected setup(_interp: Interp): void {}

	// Evaluate a program; Lisp errors are rendered into the returned output
	// rather than thrown.
	eval(code: string): string {
		let out = "";
		const prev = setWriter((s) => {
			out += s;
		});
		try {
			// Bind value before appending: `out += str(run(...))` reads `out`
			// before run() writes side-effect output into it, clobbering it.
			const value = str(run(this.currentInterp, code));
			out += `${value}\n`;
		} catch (ex) {
			if (ex instanceof EvalException) out += `${ex}\n`;
			else if (ex === EndOfFile)
				out += "unbalanced expression (unexpected end of input)\n";
			else throw ex;
		} finally {
			setWriter(prev);
		}
		return out;
	}

	// Discard all definitions; start from a fresh prelude-loaded interp.
	reset(): void {
		this.currentInterp = this.freshInterp();
	}
}

// The embeddable agent REPL: adds `halt` and the read-only conversation
// globals (`conversation`, `user-messages`, `assistant-messages`).
export class AgentRepl extends MemoryRepl {
	// Set by the `halt` built-in this REPL installs; read (and cleared) via
	// takeHalted(). `halt` is a REPL feature, not part of the language — a driver
	// looping over eval() uses it to know when to stop.
	private halted = false;
	// The host-supplied conversation snapshot, kept so a post-error `reset()`
	// can re-inject the globals until the next refresh.
	private readonly conversationVars = new Map<string, unknown>();
	// Host-supplied secrets, kept so a post-error `reset()` can re-inject them
	// into the fresh interp's registry.
	private readonly secrets = new Map<string, SecretSpec>();

	// Re-establish the halt built-in and the conversation globals on every fresh
	// interp. Guards `conversationVars` because the base constructor calls this
	// before this subclass's field initializers have run.
	protected override setup(interp: Interp): void {
		this.installHalt(interp);
		const vars = this.conversationVars;
		if (vars) for (const [name, value] of vars) defineVar(interp, name, value);
		// Note: unlike the standalone CLI, an embedded AgentRepl does NOT
		// auto-load a `.env` file — a host embedding this REPL (e.g. the pi
		// extension) supplies secrets explicitly via setSecrets/loadSecretsFromFile.
		// Re-inject explicitly-set host secrets. Guarded because the base
		// constructor calls setup() before this subclass's field initializers run.
		const secrets = this.secrets;
		if (secrets?.size) interp.setSecrets(Object.fromEntries(secrets));
	}

	// Install `(halt [value])`: record that the program asked to stop and return
	// `value` (or t). It only sets a flag — evaluation of any following forms
	// continues — so it is meant as the final form of a program.
	private installHalt(interp: Interp): void {
		const halt = interp.makeBuiltIn("halt", -1, (frame) => {
			this.halted = true;
			const rest = frame[0] as List;
			return rest === null ? true : rest.car;
		});
		interp.defineGlobal(newSym("halt"), halt, {
			signature: "(halt [value])",
			doc: "Signal the REPL to stop after this program; return `value` (or t).",
		});
	}

	// Replace the read-only conversation globals from a fresh host snapshot. Each
	// entry (e.g. `conversation`, `user-messages`) becomes a global holding the
	// Lisp translation of its JS value. Called before every eval, so the agent
	// always sees the current transcript; a `(setq conversation …)` in user code
	// survives only until the next refresh.
	setConversationVars(vars: Record<string, unknown>): void {
		this.conversationVars.clear();
		for (const [name, value] of Object.entries(vars)) {
			this.conversationVars.set(name, value);
			defineVar(this.interp, name, value);
		}
	}

	// Register host-supplied secrets. Keys (and descriptions) become listable by
	// the agent via `(secrets)`; values stay opaque and are only usable inside
	// calls (e.g. as MCP `:headers`). Each spec is a bare value or
	// `{ value, description }`. Merges into the registry; kept so `reset()`
	// re-injects them. `REPL_*` env secrets are seeded by the interp itself.
	setSecrets(record: Record<string, SecretSpec>): void {
		for (const [key, spec] of Object.entries(record))
			this.secrets.set(key, spec);
		this.interp.setSecrets(record);
	}

	// Load secrets from a `.env`-style file (KEY=VALUE lines) into the registry.
	// Entries are kept so a post-error `reset()` re-injects them.
	loadSecretsFromFile(path: string): void {
		const record = this.interp.loadSecretsFromFile(path);
		for (const [key, value] of Object.entries(record))
			this.secrets.set(key, value);
	}

	// Whether the last-evaluated program called `(halt)`; reads and clears the
	// flag so each check reflects only evaluations since the previous check.
	takeHalted(): boolean {
		const h = this.halted;
		this.halted = false;
		return h;
	}

	override reset(): void {
		super.reset();
		this.halted = false;
	}
}

// Define a single read-only conversation global on the given interp.
function defineVar(interp: Interp, name: string, value: unknown): void {
	interp.defineGlobal(newSym(name), jsToLisp(value), {
		signature: name,
		doc: "Read-only live conversation state (auto-updated each step).",
	});
}
