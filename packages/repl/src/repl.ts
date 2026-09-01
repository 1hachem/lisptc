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
 *   the finished signal (a REPL feature, not part of the language) and
 *   read-only conversation-state globals refreshed from the host each step.
 */

import {
	Cell,
	EndOfFile,
	EvalException,
	Interp,
	type List,
	newSym,
	prelude,
	run,
	setWriter,
	str,
	stripProse,
	Unspecified,
} from "@repo/interpreter/lisp.ts";
import { mcpExtension } from "@repo/interpreter/mcp.ts";
import { secretsExtension } from "@repo/interpreter/secrets.ts";

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
		// The secrets addon owns loading (from `REPL_*` env vars here — an embedded
		// REPL does not auto-load a `.env` file); the REPL just installs it.
		const interp = new Interp({
			extensions: [secretsExtension(), mcpExtension()],
		});
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
			// Evaluate before appending: run() writes side-effect output into
			// `out` first. A printing function (prin1/princ/terpri/print)
			// returns Unspecified — a sentinel meaning "already shown, don't
			// echo the value too" — so a printed value isn't shown twice.
			const value = run(this.currentInterp, code);
			if (value !== Unspecified) out += `${str(value)}\n`;
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

// The embeddable agent REPL: adds the finished signal and the read-only
// conversation globals (`conversation`, `user-messages`, `assistant-messages`).
export class AgentRepl extends MemoryRepl {
	// Raised by an eval whose program held no forms at all; read (and cleared)
	// via takeFinished(). A driver looping over eval() uses it to know when to
	// stop — there is no stop built-in, see `eval`.
	private finished = false;
	// The host-supplied conversation snapshot, kept so a post-error `reset()`
	// can re-inject the globals until the next refresh.
	private readonly conversationVars = new Map<string, unknown>();

	// Re-establish the conversation globals on every fresh interp. Guards
	// `conversationVars` because the base constructor calls this before this
	// subclass's field initializers have run. (Secrets need no handling here —
	// the secretsExtension re-seeds them on each fresh interp.)
	protected override setup(interp: Interp): void {
		const vars = this.conversationVars;
		if (vars) for (const [name, value] of vars) defineVar(interp, name, value);
	}

	// Evaluate a program, raising the finished flag if it turned out to be pure
	// prose. An agent that has nothing left to run answers in plain text, and
	// text with no forms in it is a program that does nothing — so a form-less
	// reply IS the end of the loop, and the REPL needs no stop built-in for the
	// agent to call.
	override eval(code: string): string {
		if (stripProse(code).trim() === "") this.finished = true;
		return super.eval(code);
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

	// Whether a program evaluated since the previous check was form-less prose;
	// reads and clears the flag.
	takeFinished(): boolean {
		const f = this.finished;
		this.finished = false;
		return f;
	}

	override reset(): void {
		super.reset();
		this.finished = false;
	}
}

// Define a single read-only conversation global on the given interp.
function defineVar(interp: Interp, name: string, value: unknown): void {
	interp.defineGlobal(newSym(name), jsToLisp(value), {
		signature: name,
		doc: "Read-only live conversation state (auto-updated each step).",
	});
}
