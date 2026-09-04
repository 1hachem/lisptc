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
	isTruncated,
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
import { proseExtension } from "@repo/interpreter/prose.ts";
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

// What one evaluation produced: `output` is what the interactive REPL would
// have printed (side-effect output, the last value, or a rendered error), and
// `skipped` holds one note per fragment read as prose instead of evaluated.
interface EvalResult {
	output: string;
	skipped: string[];
}

// Both halves as `eval` returns them: the skips read as trailing notes.
function render({ output, skipped }: EvalResult): string {
	let out = output;
	for (const what of skipped) out += `skipped ${what}\n`;
	return out;
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
		// REPL does not auto-load a `.env` file); the REPL just installs it. The
		// prose addon is what makes `eval`'s tolerance more than an unclosed-paren
		// rule — see the comment there.
		const interp = new Interp({
			extensions: [secretsExtension(), mcpExtension(), proseExtension()],
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
	 * Reads prose tolerantly (see `ProseMode`), because what this REPL is
	 * handed is written by a model: a sentence with a parenthesis in it —
	 * `(see below)`, or an unclosed `(` mid-sentence — is prose that happens
	 * to look like code, and evaluating it costs the step either an error it
	 * cannot act on or, for an unclosed paren, every form that followed. What
	 * was skipped is appended to the output, so the caller can still tell a
	 * misspelled function from a turn of phrase.
	 */
	eval(code: string): string {
		return render(this.evaluate(code));
	}

	// The two halves of an evaluation before they are rendered into one string,
	// for a subclass that has to tell them apart (see `AgentRepl`).
	protected evaluate(code: string): EvalResult {
		let out = "";
		const skipped: string[] = [];
		const prev = setWriter((s) => {
			out += s;
		});
		try {
			// Evaluate before appending: run() writes side-effect output into
			// `out` first. A printing function (prin1/princ/terpri/print)
			// returns Unspecified — a sentinel meaning "already shown, don't
			// echo the value too" — so a printed value isn't shown twice.
			const value = run(this.currentInterp, code, {
				prose: "tolerant",
				onProse: (what) => {
					if (!skipped.includes(what)) skipped.push(what);
				},
			});
			if (value !== Unspecified) out += `${str(value)}\n`;
		} catch (ex) {
			if (ex instanceof EvalException) out += `${ex}\n`;
			else if (ex === EndOfFile)
				out += "unbalanced expression (unexpected end of input)\n";
			else throw ex;
		} finally {
			setWriter(prev);
		}
		return { output: out, skipped };
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
	override eval(code: string): string {
		const result = this.evaluate(code);
		if (!isAnswer(code, result)) return render(result);
		this.finished = true;
		this.pendingProse.push(...result.skipped);
		return result.output;
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
		return render({ output: "", skipped: notes });
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
function isAnswer(code: string, { output, skipped }: EvalResult): boolean {
	if (stripProse(code, "strict").trim() === "") return true;
	if (output !== "" || skipped.length === 0) return false;
	return !isTruncated(code);
}

// Define a single read-only conversation global on the given interp.
function defineVar(interp: Interp, name: string, value: unknown): void {
	interp.defineGlobal(newSym(name), jsToLisp(value), {
		signature: name,
		doc: "Read-only live conversation state (auto-updated each step).",
	});
}
