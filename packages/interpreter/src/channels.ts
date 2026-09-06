/*
 * Everything the interpreter has to say, and who it is saying it to.
 *
 * The second of the two mechanisms an extension attaches through. Hooks
 * (src/hooks.ts) are for *deciding*; channels are for *reporting*. Like hooks,
 * this module imports nothing from any extension.
 *
 * The core grew this abstraction by hand three times before it was one: the
 * module-level writer behind `prin1`/`princ`, the prose skip notes threaded out
 * as a callback, and errors thrown for a host to catch and render. All three
 * were the same shape — "the interpreter says something, and different readers
 * want different subsets of it" — and `MemoryRepl` was reassembling that split
 * afterwards from `{ output, skipped }`.
 *
 * Two axes, kept apart on purpose:
 *
 * - the CHANNEL is the audience. A tool result worth 4KB to a model is noise in
 *   a terminal, and a prose skip note is worth showing the user at once but is
 *   deliberately withheld from the model until its next turn.
 * - the SEVERITY is the consequence. Both a fatal error and a printed value go
 *   to the user; what separates them is whether the program survives.
 *
 * Encoding either in the other is what forces the third bespoke callback.
 */

/*
 * How much the program survives.
 *
 * `critical` is thrown as it always was — throwing IS how the language reports
 * a fatal error, and `try` catches it — and emitted here as well, so a host can
 * read it off a channel instead of catching and re-rendering. `warning` and
 * `note` are never thrown: they are things worth saying about a program that
 * ran anyway, like a form read as prose instead of evaluated.
 *
 * There is deliberately no level between them. One that aborted the current
 * top-level form and let the rest of the program run would change what a
 * program does, and nothing needs it yet.
 */
export type Severity = "critical" | "warning" | "note";

// One thing the interpreter has to say.
export interface Diagnostic {
	channel: string;
	// Absent for plain output, which is not a diagnosis of anything.
	severity?: Severity;
	text: string;
	// The Lisp value at issue, where there is one — the same value an
	// EvalException carries for `try` to bind a handler variable to.
	value?: unknown;
	line?: number;
}

/*
 * The audiences the core knows by name.
 *
 * Extensions may use any string they like — a channel is not registered, only
 * emitted on — which is the point: a context-compression pass subscribing
 * `AgentRepl` to its own channel costs nothing in the core.
 */
export const USER = "user"; // the human: printed output, the program's value
export const MODEL = "model"; // the LLM's next context: what it must react to
export const DEBUG = "debug"; // a developer: only worth emitting if watched

// Receives every record whatever its channel — what a debug view subscribes to,
// so that nothing has to double-post to be visible.
export const ALL = "*";

export type Listener = (d: Diagnostic) => void;

export class Channels {
	private readonly listeners = new Map<string, Set<Listener>>();

	// Subscribe to one channel, or to ALL. Returns the unsubscribe.
	on(channel: string, listener: Listener): () => void {
		let set = this.listeners.get(channel);
		if (set === undefined) {
			set = new Set();
			this.listeners.set(channel, set);
		}
		set.add(listener);
		return () => {
			set.delete(listener);
		};
	}

	// Synchronous fan-out, no buffering. A listener that throws would otherwise
	// take down whatever the interpreter was doing when it emitted, so it
	// cannot: reporting must never change the program's outcome.
	emit(d: Diagnostic): void {
		for (const channel of [d.channel, ALL])
			for (const listener of this.listeners.get(channel) ?? [])
				try {
					listener(d);
				} catch {}
	}
}
