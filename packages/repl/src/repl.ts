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
	isTruncated,
	type List,
	newSym,
	prelude,
	run,
	setWriter,
	stripProse,
} from "@repo/interpreter/lisp.ts";
import { mcpExtension } from "@repo/interpreter/mcp.ts";
import { proseExtension } from "@repo/interpreter/prose.ts";
import {
	EnvSecretsStore,
	type SecretsStore,
	secretsExtension,
} from "@repo/interpreter/secrets.ts";

// A REPL owns an interpreter and can be reset to a fresh one.
export interface Repl {
	readonly interp: Interp;
	reset(): void;
}

// A REPL driven by strings rather than process I/O.
export interface InMemoryRepl extends Repl {
	eval(code: string): string;
}

// What one evaluation produced: the two copies of what the interactive REPL
// would have printed (see `evalOutput`), plus one note per fragment read as
// prose instead of evaluated.
interface EvalResult extends Bounded {
	skipped: string[];
}

function skipNotes(skipped: string[]): string {
	return skipped.map((what) => `skipped ${what}\n`).join("");
}

// An evaluation as `evalOutput` returns it: the skips read as trailing notes on
// both copies.
function render({ model, user, skipped }: EvalResult): Bounded {
	const notes = skipNotes(skipped);
	return { model: model + notes, user: user + notes };
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
		this.secrets = options.secretsStore ?? new EnvSecretsStore();
		this.currentInterp = this.freshInterp();
	}

	get interp(): Interp {
		return this.currentInterp;
	}

	private freshInterp(): Interp {
		this.compressor = new Compressor(this.wordLimit);
		// The secrets addon owns loading; an embedded REPL seeds its store from
		// `REPL_*` env vars and does NOT auto-load a `.env` file — that is
		// CLI-only. The store outlives the interp (see the field comment). The
		// prose addon is what makes `evalOutput`'s tolerance more than an
		// unclosed-paren rule — see the comment there.
		const interp = new Interp({
			extensions: [
				secretsExtension({ store: this.secrets }),
				mcpExtension(),
				compressionExtension(this.compressor),
				proseExtension(),
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
	 *
	 * Reads prose tolerantly (see `ProseMode`), because what this REPL is
	 * handed is written by a model: a sentence with a parenthesis in it —
	 * `(see below)`, or an unclosed `(` mid-sentence — is prose that happens
	 * to look like code, and evaluating it costs the step either an error it
	 * cannot act on or, for an unclosed paren, every form that followed. What
	 * was skipped is appended to the output, so the caller can still tell a
	 * misspelled function from a turn of phrase.
	 */
	evalOutput(code: string): Bounded {
		return render(this.evaluate(code));
	}

	// One evaluation before the skips are appended to it, for a subclass that
	// has to tell the two apart (see `AgentRepl`).
	protected evaluate(code: string): EvalResult {
		// The writer gets the human's copy of everything `echo` wrote; the
		// model's copy is capped against this step's word budget as each call
		// runs, and collected on the compressor.
		this.compressor.beginStep();
		let printed = "";
		const skipped: string[] = [];
		const prev = setWriter((s) => {
			printed += s;
		});
		// One line per top-level form: `name: shape`. Nothing prints the values
		// themselves — that is what `echo` is for.
		let reports = "";
		let error: Bounded = { model: "", user: "" };
		try {
			run(this.currentInterp, code, {
				prose: "tolerant",
				onProse: (what) => {
					if (!skipped.includes(what)) skipped.push(what);
				},
				onTopLevel: (form, value) => {
					reports += this.compressor.result(this.currentInterp, form, value);
				},
			});
		} catch (ex) {
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
			skipped,
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
	// Raised by an eval whose program ran nothing; read (and cleared) via
	// takeFinished(). A driver looping over eval() uses it to know when to
	// stop — there is no stop built-in, see `eval`.
	private finished = false;
	// Skip notes withheld from a prose-only answer, waiting to be handed to the
	// model with the next user message; read (and cleared) via
	// takeProseFeedback().
	private pendingProse: string[] = [];
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

	// Evaluate a program, raising the finished flag if it turned out to be an
	// answer rather than a step (see `isAnswer`). An agent that has nothing left
	// to run answers in plain text, and text that runs nothing is a program that
	// does nothing — so such a reply IS the end of the loop, and the REPL needs
	// no stop built-in for the agent to call.
	//
	// An answer's skip notes are withheld from the output rather than returned:
	// handing them back would make the host feed a result to a model that is
	// done, buying the user an extra agent turn to be told what the last one
	// already said. They wait for the next user message instead — late enough to
	// cost nothing, early enough that the model does not write the aside again.
	//
	// Overridden on `evalOutput` rather than `eval`, so the flag is raised
	// whichever entry point the driver uses.
	override evalOutput(code: string): Bounded {
		const result = this.evaluate(code);
		if (!isAnswer(code, result)) return render(result);
		this.finished = true;
		this.pendingProse.push(...result.skipped);
		return { model: result.model, user: result.user };
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

	// Whether a program evaluated since the previous check was an answer rather
	// than a step; reads and clears the flag.
	takeFinished(): boolean {
		const f = this.finished;
		this.finished = false;
		return f;
	}

	// The skip notes withheld from answers since the previous check, rendered as
	// the lines `eval` would have returned (empty when there are none); reads and
	// clears them. A host carries these to the model with the next user message,
	// which is the whole point of withholding them: the model is told what it
	// wrote as prose without the REPL having spent an agent turn saying so.
	takeProseFeedback(): string {
		const notes = this.pendingProse;
		this.pendingProse = [];
		return skipNotes(notes);
	}

	override reset(): void {
		super.reset();
		this.finished = false;
		this.pendingProse = [];
	}
}

/*
 * Was this reply the agent's answer rather than a step? It is when nothing in
 * it ran:
 *
 * - it opened no parenthesis at all — plain prose, the way an agent answers;
 * - or every parenthesis in it was prose (`all done (see above)`), so the
 *   program did nothing and printed nothing.
 *
 * The second test is the tolerant reader's, but truncation is excluded: a reply
 * cut off mid-form also runs nothing, yet it is an interrupted step, and ending
 * the loop on it would strand the task. Only an OPEN parenthesis says that —
 * an aside the reader could not parse ("(a deprecated `read_file`)") is a
 * finished sentence, and asking `checkSyntax` here would call it a truncation.
 */
function isAnswer(code: string, { user, skipped }: EvalResult): boolean {
	if (stripProse(code, "strict").trim() === "") return true;
	// The unbounded copy: it is the complete record of what the program
	// produced, where the model's is capped.
	if (user !== "" || skipped.length === 0) return false;
	return !isTruncated(code);
}

// Define a single read-only conversation global on the given interp.
function defineVar(interp: Interp, name: string, value: unknown): void {
	interp.defineGlobal(newSym(name), jsToLisp(value), {
		signature: name,
		doc: "Read-only live conversation state (auto-updated each step).",
	});
}
