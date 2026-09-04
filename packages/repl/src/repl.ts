/**
 * Reusable REPL front-ends for the Lisptc interpreter.
 *
 * The interpreter (`@repo/interpreter`) is pure language: `Interp`, `run`,
 * `str`, `prelude`, the reader. A REPL is a driver on top of it. This module
 * hosts the embeddable (string-in / string-out) REPLs; the interactive
 * stdin/stdout loop lives in `./cli.ts`.
 *
 * - `MemoryRepl` — evaluate a program string, return what the interactive REPL
 *   would have printed (`echo` output plus a one-line report per top-level
 *   form, errors rendered inline). No process I/O, so embedders can run Lisp
 *   without a subprocess.
 * - `AgentRepl` — `MemoryRepl` plus two things an embedding agent needs:
 *   the finished signal (a REPL feature, not part of the language) and
 *   read-only conversation-state globals refreshed from the host each step.
 */

import {
	type Bounded,
	Compressor,
	compressionExtension,
	MAX_WORDS,
} from "@repo/interpreter/compression.ts";
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
	stripProse,
} from "@repo/interpreter/lisp.ts";
import { mcpExtension } from "@repo/interpreter/mcp.ts";
import {
	EnvSecretsStore,
	type SecretsStore,
	secretsExtension,
} from "@repo/interpreter/secrets.ts";
import { type UiNode, UiSurface, uiExtension } from "@repo/interpreter/ui.ts";

/*
 * What one evaluation produced: the two copies of its printed output, plus the
 * widget tree it rendered, if any.
 *
 * `view` rides alongside rather than inside the text because it is not text: a
 * host that draws it (apps/app) draws it, and one that cannot (the CLI, the MCP
 * server) simply ignores the field and still gets the same output it always
 * did.
 */
export interface EvalResult extends Bounded {
	view?: UiNode;
	// What a handler asked to say to the agent (`ui/send`). Only a click can
	// deliver one — a host driving an ordinary eval has no conversation to put it
	// in and ignores the field.
	message?: string;
	// Whether the work raised a Lisp error. The message is already in the output
	// (that is how this REPL reports one), so this only saves a caller from
	// having to recognise it there.
	error: boolean;
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
	// Recreated with every interp: the naming counters must die with the globals
	// they named, or a reset() leaves the count climbing past unbound names.
	private compressor: Compressor;
	// Recreated with every interp for the same reason: a registered ui action is
	// a closure over the environment of the interp that made it.
	private surface: UiSurface;
	// One store for the life of the REPL: freshInterp() re-installs the secrets
	// extension over this same store on every reset, so a secret a host pushed
	// into it (via `repl.secrets.set(...)`) survives the reset instead of dying
	// with the interp. Env-seeded at construction from `REPL_*` vars.
	readonly secrets: SecretsStore;
	private readonly wordLimit: number;

	constructor(
		options: { wordLimit?: number; secretsStore?: SecretsStore } = {},
	) {
		// Assigned before freshInterp(), which reads it. (Same ordering trap the
		// setup() hook below warns about.)
		this.wordLimit = options.wordLimit ?? MAX_WORDS;
		this.compressor = new Compressor(this.wordLimit);
		this.surface = new UiSurface();
		this.secrets = options.secretsStore ?? new EnvSecretsStore();
		this.currentInterp = this.freshInterp();
	}

	get interp(): Interp {
		return this.currentInterp;
	}

	// The live widget surface: where a host reads the view an eval rendered and
	// routes a click on it back into this interpreter (see `invokeUi`).
	get ui(): UiSurface {
		return this.surface;
	}

	private freshInterp(): Interp {
		this.compressor = new Compressor(this.wordLimit);
		this.surface = new UiSurface();
		// The secrets addon owns loading; an embedded REPL seeds its store from
		// `REPL_*` env vars and does NOT auto-load a `.env` file — that is
		// CLI-only. The store outlives the interp (see the field comment).
		const interp = new Interp({
			extensions: [
				secretsExtension({ store: this.secrets }),
				mcpExtension(),
				compressionExtension(this.compressor),
				uiExtension(this.surface),
			],
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

	/*
	 * Evaluate a program; Lisp errors are rendered into the returned output
	 * rather than thrown.
	 *
	 * Consumers — apps/mcp, packages/ai — pass the `model` string straight to a
	 * model, so this is the only place the word cap has to hold. `user` is the
	 * same content unbounded, for a human reading it once on screen (see
	 * @repo/interpreter's compression.ts).
	 */
	evalOutput(code: string): EvalResult {
		return this.capture((report) => {
			// One line per top-level form: `name: shape`. Nothing prints the values
			// themselves — that is what `echo` is for.
			run(this.currentInterp, code, (form, value) => {
				report(this.compressor.result(this.currentInterp, form, value));
			});
		});
	}

	/*
	 * Run the handler behind an action id from a rendered widget.
	 *
	 * A click is a step of this REPL like any other — same interpreter, same
	 * definitions — so it prints and renders through exactly the same machinery.
	 * What it is NOT is a turn: the model neither asked for it nor hears about
	 * it, so nothing here is bound to a name and only the `user` copy of the
	 * output is ever read. The handler answers by rendering.
	 */
	invokeUi(action: string, values: Record<string, unknown> = {}): EvalResult {
		return this.capture(() => this.surface.invoke(action, values));
	}

	/*
	 * Run one unit of work with the REPL's output plumbing around it: a fresh
	 * word budget, `echo` writing into a buffer rather than the process, Lisp
	 * errors rendered instead of thrown, and any widget the work rendered picked
	 * up on the way out.
	 *
	 * `body` is handed a `report` sink for the result lines that go after the
	 * printed output — an eval reports one per top-level form, a click reports
	 * nothing. It is a sink rather than a return value because a form part-way
	 * through a program can throw, and the results of the forms BEFORE it were
	 * still bound to names: dropping those lines would leave the agent holding
	 * names it was never told.
	 */
	private capture(body: (report: (line: string) => void) => void): EvalResult {
		// The writer gets the human's copy of everything `echo` wrote; the
		// model's copy is capped against this step's word budget as each call
		// runs, and collected on the compressor.
		this.compressor.beginStep();
		let printed = "";
		const prev = setWriter((s) => {
			printed += s;
		});
		let reports = "";
		let error: Bounded = { model: "", user: "" };
		let failed = false;
		try {
			body((line) => {
				reports += line;
			});
		} catch (ex) {
			failed = true;
			if (ex instanceof EvalException) error = this.compressor.error(`${ex}\n`);
			else if (ex === EndOfFile) {
				const text = "unbalanced expression (unexpected end of input)\n";
				error = { model: text, user: text };
			} else throw ex;
		} finally {
			setWriter(prev);
		}
		return {
			model: this.compressor.takeEcho() + reports + error.model,
			user: printed + reports + error.user,
			view: this.surface.takeView(),
			message: this.surface.takeMessage(),
			error: failed,
		};
	}

	// The model-facing output of one eval: capped, and the string every
	// non-streaming consumer of this REPL has always received.
	eval(code: string): string {
		return this.evalOutput(code).model;
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
	//
	// Overridden on `evalOutput` rather than `eval`, so the flag is raised
	// whichever entry point the driver uses.
	override evalOutput(code: string): EvalResult {
		if (stripProse(code).trim() === "") this.finished = true;
		return super.evalOutput(code);
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
