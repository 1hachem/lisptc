/*
 * The core's extension vocabulary.
 *
 * An extension attaches through two mechanisms. This module is the first:
 * hooks, for *deciding* — should this text be read as a program, should this
 * form run, how should this value print. (The second is `src/channels.ts`, for
 * *reporting*.) Both exist so the core can ask a question without knowing who
 * answers it: this file imports nothing from any extension, and never should.
 *
 * Everything is built from one combinator. A `Chain` is an ordered list of
 * middlewares over some base behaviour, and the three shapes the core needs
 * all fall out of it:
 *
 * - a veto or a dispatch — `R` is `T | undefined` and the base answers
 *   `undefined`, so a middleware either answers or defers with `next(...)`;
 * - a wrapping — `R` is the real result and the base is the core's own
 *   behaviour, so a middleware may act before, after or around it;
 * - a broadcast — `R` is void and the base does nothing, so every middleware
 *   runs by calling `next()`.
 */
import type { Interp } from "./lisp.ts";

// A link in a chain: the hook's own arguments, plus the rest of the chain.
export type Middleware<A extends unknown[], R> = (
	...args: [...A, next: (...a: A) => R]
) => R;

export class Chain<A extends unknown[], R> {
	private readonly middlewares: Middleware<A, R>[] = [];

	// Whether anything registered — for a caller on a hot path that would
	// rather not build the chain at all (see the note on `evalForm`).
	get isEmpty(): boolean {
		return this.middlewares.length === 0;
	}

	use(middleware: Middleware<A, R>): void {
		this.middlewares.push(middleware);
	}

	/*
	 * Run the chain over `base`.
	 *
	 * Registration order is OUTERMOST-FIRST, matching the left-to-right reading
	 * of `InterpOptions.extensions`: the first extension in that array sees a
	 * value first and may answer before the later ones are asked. Folding from
	 * the end backwards is what puts middleware 0 on the outside.
	 */
	run(base: (...a: A) => R, ...args: A): R {
		let next = base;
		for (let i = this.middlewares.length - 1; i >= 0; i--) {
			const middleware = this.middlewares[i];
			const rest = next;
			next = (...a: A) => middleware(...a, rest);
		}
		return next(...args);
	}
}

// Answered `undefined` by the base of every veto chain: nobody objected.
export function noOpinion(): undefined {
	return undefined;
}

/*
 * Every question the core puts to its extensions.
 *
 * The names describe what is being decided, never who decides it — an interp
 * with no extension installed answers all of them the same way, by running
 * each chain's base. `proseExtension()` (src/prose.ts) is the only user of the
 * three reader hooks today, but nothing here knows that.
 *
 * The split between the first two and the third is what the reader can settle:
 * `unclosedForm` and `unreadableForm` are put text that never became a form,
 * `skipForm` only a form that parsed. Each answers with the note to report the
 * skip with, or `undefined` to leave the text as program text.
 */
export interface Hooks {
	// A "(" at `at` that is never closed.
	readonly unclosedForm: Chain<[text: string, at: number], string | undefined>;
	// A balanced form spanning [start, end) that will not parse.
	readonly unreadableForm: Chain<
		[text: string, start: number, end: number],
		string | undefined
	>;
	// A parsed top-level form, about to be evaluated.
	readonly skipForm: Chain<[interp: Interp, form: unknown], string | undefined>;
	/*
	 * Evaluating one top-level form, with the base doing the evaluation.
	 *
	 * A wrapping chain, so a middleware sees the form on the way in and the
	 * value on the way out, and may act around either — which is what an
	 * extension that reports on results needs, and what a step budget or a
	 * trace would use.
	 *
	 * The TOP level only, deliberately. `Interp.eval` runs for every
	 * subexpression, so a chain there would be a hot path paid by every program
	 * whether or not anything registered; this one runs once per form. An
	 * extension needing per-step granularity should be the change that adds a
	 * finer hook, guarded by `isEmpty`.
	 */
	readonly evalForm: Chain<[interp: Interp, form: unknown], unknown>;
	/*
	 * This interp is being thrown away — release what the language cannot.
	 *
	 * A broadcast rather than a veto: the base does nothing and every
	 * middleware runs by calling `next()`, so no extension can stop another
	 * from cleaning up. Run by `Interp.dispose()`, which a host calls before
	 * dropping an interp (see `MemoryRepl.reset`). An extension whose resources
	 * the agent can also release itself — `mcp-shutdown` — registers here too,
	 * and must be idempotent: both paths may fire.
	 */
	readonly dispose: Chain<[], void>;
}

export function newHooks(): Hooks {
	return {
		unclosedForm: new Chain(),
		unreadableForm: new Chain(),
		skipForm: new Chain(),
		evalForm: new Chain(),
		dispose: new Chain(),
	};
}
