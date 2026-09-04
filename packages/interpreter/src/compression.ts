/*
 * Context compression for Lisptc.
 *
 * The REPL is an LLM's only interface, so everything it prints is spent
 * context. This module spends as little of it as possible:
 *
 *  - The REPL prints NOTHING on its own. Every top-level result is bound to a
 *    global named after the function that produced it —
 *    `linear/list-issues-1` — and reported as one line, `name: shape`, that
 *    describes the value instead of showing it. Data the agent never saw is
 *    data it cannot mis-copy, and the next step refers to the name.
 *  - `echo` is the one command that writes, and what it writes is capped at a
 *    word limit. Past the cap the text stops and a `...` line reports how much
 *    was shown and how to read on.
 *  - `head` / `tail` / `grep` do not print: they RETURN a value, which is
 *    therefore reported and named like any other result. That is the pattern
 *    the agent is meant to reach for — extract into a name, then `echo` a
 *    rendering of it — instead of reading data off a printout and retyping it.
 *
 * Reporting a shape rather than a value is only safe because of the naming:
 * nothing is ever lost by not printing it. See devdocs/compression.md.
 *
 * An opt-in extension, like src/secrets.ts: pass `compressionExtension()` in
 * `InterpOptions.extensions`. The `Compressor` holding the naming counters is
 * created by the host per interpreter, so `reset()` restarts numbering along
 * with the globals it named.
 */
import { z } from "zod";
import {
	Cell,
	callableKind,
	type DocArg,
	EvalException,
	echoText,
	type Interp,
	type InterpExtension,
	type List,
	newSym,
	Sym,
	str,
	Unspecified,
	writeOut,
	zAny,
	zList,
} from "./lisp.ts";
import { plistOptions, splitKeywordArgs } from "./plist.ts";

// Words `echo` will write before truncating. ~550 tokens, so a 25-step agent
// loop spends at most ~14k tokens on printed output.
export const MAX_WORDS = 400;

// A result of at most this many words is reported as itself rather than
// described: below it, a shape costs more to read than the value it hides.
const INLINE_WORDS = 10;

// Elements `head`/`tail` take from a list when no count is given.
const DEFAULT_ITEMS = 10;

// Characters allowed per word of budget. A word cap alone does not bound
// anything: minified JSON is a single megabyte-long "word". This backstop cuts
// such a blob mid-word rather than printing all of it.
const MAX_CHARS_PER_WORD = 12;

// Give up scanning for further regex matches after this many, so a pattern
// matching every character on a huge value cannot hang the interpreter.
const MAX_MATCHES_SCANNED = 10_000;

// Words of context shown either side of a `grep` hit, and hits printed.
const DEFAULT_CONTEXT = 8;
const DEFAULT_MAX_HITS = 10;

// A string argument. Local to this module, as in src/secrets.ts, so the
// built-ins here don't widen the interpreter's public API.
const zString = z.custom<string>(
	(x) => typeof x === "string",
	"string expected",
);

/*
 * The one text a value is measured, windowed and searched over.
 *
 * A word offset only means anything if every command counting words agrees on
 * the string it is counting, so they all go through here — and it is the same
 * rendering `echo` writes (`echoText` in src/lisp.ts), so an offset `echo`
 * reports can be fed straight back to it. Strings render raw rather than
 * through `str` because `str` escapes newlines as a literal `\n`, which turns a
 * long document into one unreadable line.
 */
function canonical(x: unknown): string {
	return typeof x === "string" ? x : str(x);
}

// Character ranges of the whitespace-separated words in `text`.
function wordSpans(text: string): [number, number][] {
	const spans: [number, number][] = [];
	const re = /\S+/g;
	for (let m = re.exec(text); m !== null; m = re.exec(text))
		spans.push([m.index, m.index + m[0].length]);
	return spans;
}

/*
 * Text bounded two ways: `model` capped at the word limit, `user` as it was
 * written.
 *
 * A human reads output once, on screen, so capping it buys nothing; the model
 * carries it for the rest of the loop, so the cap is what keeps 25 steps
 * affordable. One eval produces both from the same write.
 */
export interface Bounded {
	model: string;
	user: string;
}

interface Slice {
	text: string;
	above: number;
	shown: number;
	below: number;
	total: number;
	// The single word at `offset` exceeded the character budget on its own and
	// was hard-cut. Word offsets cannot page past it, so the marker has to
	// point at `substring` instead of an `:offset`.
	cut: boolean;
	// Characters of `text` this window covers, and in the whole value.
	chars: number;
	totalChars: number;
}

/*
 * The window of `text` starting at word `offset`, at most `length` words long.
 *
 * Slices the original string between the first and last word's character
 * offsets rather than re-joining the words, so interior newlines and alignment
 * survive — tool output is often the thing being read.
 */
function sliceWords(
	text: string,
	spans: readonly [number, number][],
	offset: number,
	length: number,
	charBudget: number,
): Slice {
	const total = spans.length;
	const totalChars = text.length;
	const from = Math.min(Math.max(0, offset), total);
	const first = spans[from];
	if (first === undefined)
		return {
			text: "",
			above: total,
			shown: 0,
			below: 0,
			total,
			cut: false,
			chars: 0,
			totalChars,
		};

	const startChar = first[0];
	let to = from;
	let endChar = first[1];
	while (to < total && to - from < length) {
		const span = spans[to];
		if (span === undefined) break;
		if (to > from && span[1] - startChar > charBudget) break;
		endChar = span[1];
		to++;
	}

	let out = text.slice(startChar, endChar);
	// Only reachable when the first word alone is over budget: the loop above
	// stops before adding any later word that would cross it.
	const cut = out.length > charBudget;
	if (cut) out = out.slice(0, charBudget);
	return {
		text: out,
		above: from,
		shown: to - from,
		below: total - to,
		total,
		cut,
		chars: out.length,
		totalChars,
	};
}

// How many words lie above/below the window, phrased for the marker line.
function position(s: Slice): string {
	if (s.cut)
		return `${s.chars} of ${s.totalChars} characters shown (one unbroken word)`;
	const parts = [`${s.shown} of ${s.total} words shown`];
	if (s.above > 0) parts.push(`${s.above} above`);
	if (s.below > 0) parts.push(`${s.below} below`);
	return parts.join(", ");
}

/*
 * The `...` line closing a truncated `echo`.
 *
 * `name` is the global holding the value, when there is one: `(echo range-1
 * :offset 40)` reads on, while an unnamed value — a literal the agent passed
 * straight to `echo` — can only be given the offset to use.
 */
function echoMarker(s: Slice, name: string | undefined): string {
	if (s.above === 0 && s.below === 0 && !s.cut) return "";
	// A hard-cut word has no next word offset to jump to, so slice it by
	// character with the prelude's `substring` instead.
	if (s.cut)
		return `... ${position(s)} — ${
			name === undefined
				? `slice it by character with substring, from ${s.chars}`
				: `read on with (echo (substring ${name} ${s.chars} ${Math.min(s.totalChars, s.chars * 2)}))`
		}`;
	const atEnd = s.below === 0;
	const next = atEnd ? 0 : s.above + s.shown;
	const verb = atEnd ? "back to the start with" : "read on with";
	const how =
		name === undefined
			? `${atEnd ? "back to the start at" : "read on from"} :offset ${next}`
			: `${verb} (echo ${name} :offset ${next})`;
	return `... ${position(s)} — ${how}`;
}

function intOption(
	opts: Map<string, unknown>,
	name: string,
	fallback: number,
): number {
	const raw = opts.get(name);
	if (raw === undefined) return fallback;
	const n = typeof raw === "bigint" ? Number(raw) : raw;
	if (typeof n !== "number" || !Number.isInteger(n) || n < 0)
		throw new EvalException(`non-negative integer expected for :${name}`, raw);
	return n;
}

// Only `nil` is false in this dialect, so an absent option and an explicit nil
// are different things: `:ignore-case nil` must turn matching case-sensitive.
function boolOption(
	opts: Map<string, unknown>,
	name: string,
	fallback: boolean,
): boolean {
	if (!opts.has(name)) return fallback;
	return opts.get(name) !== null;
}

/*
 * Naming counters for one interpreter, the current step's output budget, and
 * every render entry point.
 *
 * Holds no values: a named result is an ordinary global, which is what lets
 * `echo`/`grep` take a value rather than a handle and work just as well on data
 * the agent bound itself.
 */
export class Compressor {
	private readonly counters = new Map<string, number>();
	// This step's `echo` output as the model will see it, the words of it
	// already spent, and the words written that it was not shown. All three are
	// reset by `beginStep`.
	private echoed = "";
	private spent = 0;
	private dropped = 0;
	readonly limit: number;

	constructor(limit: number = MAX_WORDS) {
		this.limit = limit;
	}

	private get charBudget(): number {
		return this.limit * MAX_CHARS_PER_WORD;
	}

	/*
	 * Bind a top-level result to a name and report it as `name: shape`.
	 *
	 * The line describes the value instead of showing it. That is the whole
	 * bargain: the agent gets the handle and the structure — enough to write
	 * the next form — and never sees data it could copy by hand, which is
	 * where both the token spend and the hallucinated-value risk live. To see
	 * a value it must ask, with `echo`.
	 */
	result(interp: Interp, form: unknown, value: unknown): string {
		// A step that ended in an `echo` has already said everything it has to
		// say; a report on top would only announce that printing happened.
		if (value === Unspecified) return "";
		// A slice is asked for in order to be READ, so the report for a
		// top-level `head`/`tail` is the slice itself: describing it back as
		// `head-1: list of 10 items` sends the agent for an `(echo head-1)` it
		// should never have had to spend a step on.
		if (isSliceForm(form)) {
			this.print(interp, value);
			return "";
		}
		// nil and t are their own shape, and every side-effecting loop returns
		// nil — naming those would bury the results that matter under
		// `dotimes-1: nil`.
		if (value === null || value === true) return `${str(value)}\n`;
		// `(defun f …)` returns the symbol it defined; the binding it made is
		// the result, so report it under that name rather than minting one.
		if (value instanceof Sym && interp.hasGlobal(value))
			return `${value.name}: ${describe(interp.getGlobal(value))}\n`;

		return `${this.nameFor(interp, form, value)}: ${describe(value)}\n`;
	}

	/*
	 * Start a step: the word budget is per eval, not per `echo` call.
	 *
	 * An echo loop floods the context just as effectively as one huge echo, so
	 * the limit is shared. Each call takes what is left (`this.spent`), and the
	 * capping happens inside `window`/`search` — the only place that still
	 * knows which value the text came from, and so the only place that can
	 * point the agent back at it by name.
	 */
	beginStep(): void {
		this.echoed = "";
		this.spent = 0;
		this.dropped = 0;
	}

	/*
	 * This step's `echo` output as the model should see it, and a closing note
	 * for anything it was not shown. Reads and does not clear: `beginStep`
	 * does that, so a host that forgets to call it sees output accumulate
	 * rather than vanish.
	 */
	takeEcho(): string {
		if (this.dropped === 0) return this.echoed;
		return `${this.echoed}... ${this.dropped} more word${this.dropped === 1 ? "" : "s"} of echo output not shown to you (a step may echo ${this.limit} words); echo less, or echo a named value you can page through\n`;
	}

	private get remaining(): number {
		return Math.max(0, this.limit - this.spent);
	}

	// Keep the model's copy of one echo, charge it to the step's budget, and
	// count what the model was not shown.
	private echo(model: string, user: string, dropped: number): Bounded {
		this.echoed += model;
		this.spent += wordSpans(model).length;
		this.dropped += dropped;
		return { model, user };
	}

	// Write a value the way `echo` writes it: the human's copy straight out,
	// the model's capped against what is left of this step's budget.
	private print(interp: Interp, value: unknown): void {
		writeOut(
			this.window(
				interp,
				echoText(new Cell(value, null)),
				value,
				0,
				Number.MAX_SAFE_INTEGER,
			).user,
		);
	}

	// Cap a rendered error. Nothing is saved: an EvalException's message is
	// derived from a value the program still has.
	error(text: string): Bounded {
		const spans = wordSpans(text);
		const s = sliceWords(text, spans, 0, this.limit, this.charBudget);
		if (s.below === 0 && !s.cut) return { model: text, user: text };
		return {
			model: `${s.text}\n... ${position(s)} (error message truncated)\n`,
			user: text,
		};
	}

	/*
	 * The window `(echo x :offset n :length n)` writes.
	 *
	 * `user` is what was asked for; `model` is as much of it as this step's
	 * budget still allows, closing with a `...` line that names the value and
	 * the offset to resume from. Both come out of one slicing pass, because the
	 * offsets in that line are only meaningful in the whole value's
	 * coordinates — capping the window a second time downstream would restart
	 * them from zero and point the agent at the wrong place.
	 */
	window(
		interp: Interp,
		text: string,
		value: unknown,
		offset: number,
		length: number,
	): Bounded {
		const spans = wordSpans(text);
		// Nothing to window: `(echo)` is a blank line, and whitespace is itself.
		if (spans.length === 0) return this.echo(`${text}\n`, `${text}\n`, 0);

		const asked = sliceWords(
			text,
			spans,
			offset,
			length,
			Number.MAX_SAFE_INTEGER,
		);
		if (asked.shown === 0) {
			const nothing = `(nothing at :offset ${offset}; ${asked.total} words in total)\n`;
			return this.echo(nothing, nothing, 0);
		}
		// The human's copy carries a marker too when the window they asked for
		// is a partial view — `:length 2` of a longer value really does leave
		// something below, and saying so costs one line. What it never carries
		// is the step-budget truncation, which is the model's concern alone.
		const name = this.existingName(interp, value);
		const askedMark = echoMarker(asked, name);
		const user =
			askedMark === "" ? `${asked.text}\n` : `${asked.text}\n${askedMark}\n`;

		const shown = sliceWords(
			text,
			spans,
			offset,
			Math.min(length, this.remaining),
			this.charBudget,
		);
		// Nothing left in the budget: this call is invisible to the model, so
		// its words are what `takeEcho`'s closing note has to account for.
		if (shown.shown === 0) return this.echo("", user, asked.shown);
		// A shorter window is not silent — its own `...` line says how much is
		// below and how to read on — so it needs no note on top of that.
		const mark = echoMarker(shown, name);
		return this.echo(
			mark === "" ? `${shown.text}\n` : `${shown.text}\n${mark}\n`,
			user,
			0,
		);
	}

	/*
	 * What `(echo x :match "…")` writes: each hit as `@<word-offset>` plus the
	 * surrounding words.
	 *
	 * Offsets rather than line numbers because `str` of a large list is a single
	 * line with no newlines in it at all — a line-oriented search would report
	 * one enormous match. A word window behaves the same on a one-line Lisp
	 * render and on multi-line text, and the offset it prints feeds straight
	 * back into `(echo x :offset N)`.
	 *
	 * This is for reading a blob you cannot yet name a pattern for. To keep
	 * what matched, use `grep`, which returns it.
	 */
	search(
		interp: Interp,
		text: string,
		value: unknown,
		pattern: string,
		options: { context: number; max: number; ignoreCase: boolean },
	): Bounded {
		const spans = wordSpans(text);
		const name = this.existingName(interp, value);
		const re = compile(pattern, options.ignoreCase);

		const lines: string[] = [];
		// Hits past this step's remaining budget are still written for the
		// human; the model is told how many it did not see.
		let shownToModel = 0;
		let found = 0;
		let scanned = 0;
		let skipped = 0;
		let printedWords = 0;
		let coveredTo = -1; // last word index already inside a printed window

		for (let m = re.exec(text); m !== null; m = re.exec(text)) {
			// A zero-length match (e.g. "a*") never advances lastIndex on its
			// own, so the loop would not terminate.
			if (m.index === re.lastIndex) re.lastIndex++;
			if (++scanned > MAX_MATCHES_SCANNED) break;
			found++;

			const at = wordIndexAt(spans, m.index);
			if (at <= coveredTo) {
				skipped++;
				continue;
			}
			if (lines.length >= options.max) continue;

			const from = Math.max(0, at - options.context);
			const to = Math.min(spans.length - 1, at + options.context);
			const start = spans[from]?.[0] ?? 0;
			const end = spans[to]?.[1] ?? text.length;
			const excerpt = markMatch(
				text.slice(start, end),
				m.index - start,
				m[0].length,
			).replace(/\s+/g, " ");
			lines.push(`@${at}  ${excerpt}`);
			printedWords += to - from + 1;
			if (printedWords <= this.remaining) shownToModel = lines.length;
			coveredTo = to;
		}

		const render = (hits: readonly string[]): string =>
			`${[
				...hits,
				searchSummary(
					found,
					skipped,
					hits.length,
					pattern,
					spans.length,
					name,
					scanned,
				),
			]
				.filter((l) => l !== "")
				.join("\n")}\n`;

		// Both copies close with the same summary — "N matches …; showing M" —
		// so a shorter list of hits reports itself and needs no closing note.
		const user = render(lines);
		return this.echo(render(lines.slice(0, shownToModel)), user, 0);
	}

	/*
	 * The name to report a result under, minting one if the value has none.
	 *
	 * A value that is already reachable by a name reuses it rather than getting
	 * a second one. That is not a nicety: it is what makes `(setq issues (big))`
	 * report `issues`, and `(defun f …)` report `f`, without either needing to
	 * be special-cased by head symbol.
	 */
	private nameFor(interp: Interp, form: unknown, value: unknown): string {
		// A form that defined a global returns its symbol.
		if (value instanceof Sym && interp.hasGlobal(value)) return value.name;

		const head = form instanceof Object && "car" in form ? form.car : undefined;

		// `(setq x …)` already put the value somewhere the agent can reach; the
		// name it assigned is the answer, whatever the value's type. Reverse
		// lookup below would only find it for a Cell or a string.
		if (head instanceof Sym && head.name === "setq") {
			const assigned = lastAssignedSymbol(form);
			if (assigned !== undefined) return assigned;
		}

		const existing = this.existingName(interp, value);
		if (existing !== undefined) return existing;

		const base = head instanceof Sym ? head.name : "result";
		const total = wordSpans(canonical(value)).length;
		return this.bind(interp, base, value, total);
	}

	/*
	 * The name of an existing global bound to exactly this value, if any.
	 *
	 * Restricted to values worth naming: a reverse lookup on numbers or
	 * booleans would match any unrelated global that happens to hold the same
	 * one. Strings compare by value, so an unrelated global holding an equal
	 * string can match — harmless, since the two are interchangeable to read.
	 */
	private existingName(interp: Interp, value: unknown): string | undefined {
		if (!(value instanceof Object) && typeof value !== "string")
			return undefined;
		if (value instanceof Sym) return undefined;
		for (const [sym, bound] of interp.globalEntries())
			if (bound === value) return sym.name;
		return undefined;
	}

	// Bind `value` to a fresh `<base>-<n>` global and return the name.
	private bind(
		interp: Interp,
		base: string,
		value: unknown,
		total: number,
	): string {
		let n = (this.counters.get(base) ?? 0) + 1;
		let name = `${base}-${n}`;
		// Never clobber a name the agent bound itself.
		while (interp.hasGlobal(newSym(name))) name = `${base}-${++n}`;
		this.counters.set(base, n);
		interp.defineGlobal(newSym(name), value, {
			signature: name,
			doc: `Saved result of a \`${base}\` call (${total} words). The REPL reported its shape rather than printing it; this holds the whole value. Compute over it — (length ${name}), mapcar, assoc — or pull out what you need with (grep ${name} "pattern") or (head ${name} n). To look at it, (echo ${name}).`,
		});
		return name;
	}
}

// Was this top-level form a slice taken to be looked at? Only the bare form
// counts: nested — `(mapcar f (head x 2))` — the slice is an argument to
// someone else's computation and printing it would leak data the step never
// asked to see.
function isSliceForm(form: unknown): boolean {
	if (!(form instanceof Cell) || !(form.car instanceof Sym)) return false;
	return form.car.name === "head" || form.car.name === "tail";
}

// The symbol a `(setq a 1 b 2)` form assigned last — the one holding the value
// the form returned.
function lastAssignedSymbol(form: unknown): string | undefined {
	let arg: unknown = form instanceof Object && "cdr" in form ? form.cdr : null;
	let last: string | undefined;
	for (let i = 0; arg instanceof Object && "car" in arg; i++) {
		if (i % 2 === 0 && arg.car instanceof Sym) last = arg.car.name;
		arg = "cdr" in arg ? arg.cdr : null;
	}
	return last;
}

// The index of the word containing (or following) character `char`.
function wordIndexAt(spans: readonly [number, number][], char: number): number {
	let lo = 0;
	let hi = spans.length - 1;
	let best = 0;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		const span = spans[mid];
		if (span === undefined) break;
		if (span[0] <= char) {
			best = mid;
			lo = mid + 1;
		} else {
			hi = mid - 1;
		}
	}
	return best;
}

// Wrap the matched span in [[ ]]. Splices the closing pair first so the opening
// index stays valid.
function markMatch(excerpt: string, at: number, length: number): string {
	if (at < 0 || at > excerpt.length) return excerpt;
	const end = Math.min(excerpt.length, at + length);
	return `${excerpt.slice(0, at)}[[${excerpt.slice(at, end)}]]${excerpt.slice(end)}`;
}

function searchSummary(
	found: number,
	skipped: number,
	printed: number,
	pattern: string,
	total: number,
	name: string | undefined,
	scanned: number,
): string {
	if (found === 0) return `... no match for "${pattern}" in ${total} words`;
	const more = scanned > MAX_MATCHES_SCANNED ? "+" : "";
	const parts = [
		`... ${found}${more} ${found === 1 && more === "" ? "match" : "matches"} for "${pattern}" in ${total} words; showing ${printed}`,
	];
	if (skipped > 0) parts.push(`${skipped} in a region already shown`);
	const target = name === undefined ? "<value>" : name;
	return `${parts.join(", ")}. Read a region with (echo ${target} :offset <offset>), or keep what matched with (grep ${target} "${pattern}")`;
}

/*
 * A regular expression, or a Lisp error naming the problem.
 *
 * Shared by `echo :match` and `grep` so a bad pattern fails the same way in
 * both, and never as a raw JS SyntaxError.
 */
function compile(pattern: string, ignoreCase: boolean): RegExp {
	try {
		return new RegExp(pattern, ignoreCase ? "gi" : "g");
	} catch (ex) {
		throw new EvalException(
			`invalid regular expression (${ex instanceof Error ? ex.message : "unparseable"})`,
			pattern,
			false,
		);
	}
}

// The elements of a proper list, or undefined for anything that is not one.
// `nil` is the empty list, not a non-list.
function listElements(x: unknown): unknown[] | undefined {
	if (x === null) return [];
	if (!(x instanceof Cell)) return undefined;
	const out: unknown[] = [];
	for (let p: unknown = x; p instanceof Cell; p = p.cdr) out.push(p.car);
	return out;
}

function toList(items: readonly unknown[]): List {
	let out: List = null;
	for (let i = items.length - 1; i >= 0; i--) out = new Cell(items[i], out);
	return out;
}

// The keys of an alist — a list of (string . value) pairs — or undefined if `x`
// is not one. One non-pair is enough to disqualify it: a description promising
// keys the agent can `assoc` has to be true of every element.
function alistKeys(x: unknown): string[] | undefined {
	const pairs = listElements(x);
	if (pairs === undefined || pairs.length === 0) return undefined;
	const keys: string[] = [];
	for (const pair of pairs) {
		if (!(pair instanceof Cell) || typeof pair.car !== "string")
			return undefined;
		keys.push(pair.car);
	}
	return keys;
}

// The character range of `count` words starting at word `from`, sliced out of
// the original text so interior newlines and alignment survive.
function wordWindow(
	text: string,
	spans: readonly [number, number][],
	from: number,
	count: number,
): string {
	if (count <= 0 || spans.length === 0) return "";
	const start = spans[Math.min(from, spans.length - 1)]?.[0] ?? 0;
	const last = spans[Math.min(from + count, spans.length) - 1];
	return text.slice(start, last?.[1] ?? text.length);
}

/*
 * `head` / `tail`: the first (or last) `n` of a value.
 *
 * Element-wise on a list, word-wise on anything else. That polymorphism is the
 * point: `(head issues 4)` is the four rows an agent means by "the first four",
 * while `(head doc 40)` is the opening of a document. Both return the slice —
 * it is `result` that prints it when the form was a step of its own (see
 * `isSliceForm`), so a nested slice stays as silent as any other function.
 */
function headOf(value: unknown, n: number): unknown {
	const items = listElements(value);
	if (items !== undefined) return toList(items.slice(0, n));
	const text = canonical(value);
	return wordWindow(text, wordSpans(text), 0, n);
}

function tailOf(value: unknown, n: number): unknown {
	const items = listElements(value);
	if (items !== undefined)
		return toList(n >= items.length ? items : items.slice(items.length - n));
	const text = canonical(value);
	const spans = wordSpans(text);
	return wordWindow(text, spans, Math.max(0, spans.length - n), n);
}

/*
 * `grep`: what matched, as a value.
 *
 * On a list, the elements whose printed form matches — so `(grep issues
 * "auth")` is the issues about auth, ready to map over. On anything else, the
 * matched substrings (or one capture group of each) — so `(grep page
 * "https?://[^ ]+")` extracts the URLs instead of showing them to be copied by
 * hand. Returns nil when nothing matched.
 */
function grepOf(
	value: unknown,
	pattern: string,
	options: { group?: number; max: number; ignoreCase: boolean },
): List {
	const re = compile(pattern, options.ignoreCase);
	const items = listElements(value);
	if (items !== undefined) {
		const hits: unknown[] = [];
		for (const item of items) {
			re.lastIndex = 0;
			if (re.test(canonical(item))) hits.push(item);
			if (hits.length >= options.max) break;
		}
		return toList(hits);
	}

	const text = canonical(value);
	const hits: string[] = [];
	let scanned = 0;
	for (let m = re.exec(text); m !== null; m = re.exec(text)) {
		// A zero-length match (e.g. "a*") never advances lastIndex on its own,
		// so the loop would not terminate.
		if (m.index === re.lastIndex) re.lastIndex++;
		if (++scanned > MAX_MATCHES_SCANNED) break;
		const picked = options.group === undefined ? m[0] : m[options.group];
		if (picked !== undefined) hits.push(picked);
		if (hits.length >= options.max) break;
	}
	return toList(hits);
}

/*
 * How a result is reported: its value if that is small, its shape if it is not.
 *
 * A shape tells the agent what it needs to write the next form — how many
 * elements, which keys to `assoc` — without showing it data it could retype.
 * Below the threshold that reasoning inverts: `(+ 1 2)` described as "a number"
 * would cost an extra `echo` step to learn what every other REPL says outright,
 * and three tokens of value cannot be mis-copied at scale.
 */
function describe(value: unknown): string {
	const callable = callableKind(value);
	if (callable !== undefined) return callable;

	const text = canonical(value);
	const spans = wordSpans(text);
	if (
		spans.length <= INLINE_WORDS &&
		text.length <= INLINE_WORDS * MAX_CHARS_PER_WORD
	)
		return str(value);

	const items = listElements(value);
	if (items !== undefined && items.length > 0) {
		const keys = alistKeys(items[0]);
		if (keys !== undefined) {
			const uniform = items.every(
				(el) => alistKeys(el)?.join(" ") === keys.join(" "),
			);
			return `list of ${items.length} ${items.length === 1 ? "alist" : "alists"}, keys ${keys
				.map((k) => JSON.stringify(k))
				.join(" ")}${uniform ? "" : " (keys vary)"}`;
		}
		const own = alistKeys(value);
		if (own !== undefined)
			return `alist, keys ${own.map((k) => JSON.stringify(k)).join(" ")}`;
		return `list of ${items.length} items, ${spans.length} words`;
	}
	// A blob with no whitespace in it — minified JSON, a base64 payload — has a
	// word count of 1 however big it is, so measure that in characters.
	if (spans.length <= INLINE_WORDS) return `${text.length} characters`;
	return `${spans.length} words`;
}

const ECHO_OPTIONS = [
	"offset",
	"length",
	"match",
	"context",
	"max",
	"ignore-case",
];

const ECHO_ARGS: DocArg[] = [
	{
		name: "offset",
		type: "integer",
		required: false,
		description: "words to skip before the window starts (default 0)",
	},
	{
		name: "length",
		type: "integer",
		required: false,
		description: "words to show, capped at the output limit",
	},
	{
		name: "match",
		type: "string",
		required: false,
		description:
			"print only the regions matching this regular expression, each with its word offset",
	},
	{
		name: "context",
		type: "integer",
		required: false,
		description: `with :match, words of context either side of a hit (default ${DEFAULT_CONTEXT})`,
	},
	{
		name: "max",
		type: "integer",
		required: false,
		description: `with :match, hits to print (default ${DEFAULT_MAX_HITS})`,
	},
	{
		name: "ignore-case",
		type: "boolean",
		required: false,
		description: "with :match, pass nil to match case-sensitively (default t)",
	},
];

const GREP_OPTIONS = ["group", "max", "ignore-case"];

const GREP_ARGS: DocArg[] = [
	{
		name: "group",
		type: "integer",
		required: false,
		description:
			"on text, keep this capture group of each match instead of the whole match",
	},
	{
		name: "max",
		type: "integer",
		required: false,
		description: "keep at most this many matches (default: all of them)",
	},
	{
		name: "ignore-case",
		type: "boolean",
		required: false,
		description: "pass nil to match case-sensitively (default t)",
	},
];

function registerCompression(interp: Interp, c: Compressor): void {
	/*
	 * `echo`, overriding the plain core version (src/lisp.ts) with the windowed,
	 * searchable one — the same `interp.def` override idiom src/secrets.ts uses
	 * on the string primitives.
	 */
	interp.def(
		"echo",
		-1,
		'(echo x... [:offset 0] [:length n] [:match "re"] [:context 8] [:max 10] [:ignore-case t])',
		`Print the arguments, separated by spaces and followed by a newline: strings as they are, everything else in re-readable form. Output is measured in whitespace-separated words and stops after ${c.limit} of them, closing with a \`...\` line saying how much is left and the offset to continue from. :offset and :length choose the window. :match prints only the regions matching a JavaScript-syntax regular expression, each as @<word-offset> with the match wrapped in [[ ]] — that is how you read a value you cannot yet name a pattern for; to KEEP what matched rather than look at it, use \`grep\`, which returns it. A keyword prints as itself when it is the last argument — (echo (job-status job)) — since only a keyword carrying a value after it is read as an option. Returns an unspecified value, so a step ending in an echo gets no result line: what was printed IS the report.`,
		z.tuple([zList]),
		([rest]) => {
			const { values, options } = splitKeywordArgs(rest, ECHO_OPTIONS);
			const opts = plistOptions(options, ECHO_OPTIONS);
			const text = echoText(values);
			// An offset or a name in the `...` line only means anything for a
			// single value: with several, the text is a join of their renders and
			// no global holds it.
			const single =
				values !== null && values.cdr === null ? values.car : undefined;
			// The human gets what was asked for; the model gets as much of it as
			// the step's budget allows. Only the writer is uncapped here — the
			// model's copy is collected on the compressor (see `takeEcho`).
			const pattern = opts.get("match");
			if (pattern !== undefined) {
				if (typeof pattern !== "string")
					throw new EvalException("string expected for :match", pattern);
				writeOut(
					c.search(interp, text, single, pattern, {
						context: intOption(opts, "context", DEFAULT_CONTEXT),
						max: intOption(opts, "max", DEFAULT_MAX_HITS),
						ignoreCase: boolOption(opts, "ignore-case", true),
					}).user,
				);
				return Unspecified;
			}
			writeOut(
				c.window(
					interp,
					text,
					single,
					intOption(opts, "offset", 0),
					// No :length means the whole value: it is the STEP that is
					// bounded, not the request.
					intOption(opts, "length", Number.MAX_SAFE_INTEGER),
				).user,
			);
			return Unspecified;
		},
		ECHO_ARGS,
	);

	interp.def(
		"head",
		-2,
		"(head x [n])",
		`The first \`n\` of \`x\`: its first n ELEMENTS if it is a list, its first n words if it is text (default ${DEFAULT_ITEMS} elements, ${c.limit} words). Written as a step of its own the slice is PRINTED — it is what you came for, so there is no \`(echo head-1)\` to follow it with and no name is minted. The value is returned as well, so (setq first (head x 5)) keeps it under a name and (mapcar f (head x 5)) computes over it; inside another form it prints nothing.`,
		z.tuple([zAny, zList]),
		([value, rest]) => headOf(value, countArg(rest, value, c.limit)),
	);

	interp.def(
		"tail",
		-2,
		"(tail x [n])",
		`The last \`n\` of \`x\`: its last n ELEMENTS if it is a list, its last n words if it is text (default ${DEFAULT_ITEMS} elements, ${c.limit} words). Printed when it is a step of its own, returned in every case — see \`head\`.`,
		z.tuple([zAny, zList]),
		([value, rest]) => tailOf(value, countArg(rest, value, c.limit)),
	);

	interp.def(
		"grep",
		-3,
		'(grep x "pattern" [:group n] [:max n] [:ignore-case t])',
		'Return what `pattern` — a JavaScript-syntax regular expression — matches in `x`, as a list, or nil if nothing did. On a list: the ELEMENTS whose printed form matches, so (grep issues "auth") is the issues about auth. On text: the matched substrings, so (grep page "https?://[^ ]+") extracts the URLs — use this instead of reading a URL off a printout and retyping it. Case-insensitive unless you pass :ignore-case nil. Returns the value rather than printing it, so the REPL names the result; to look at a region of a value instead, use (echo x :match "pattern").',
		z.tuple([zAny, zString, zList]),
		([value, pattern, rest]) => {
			const opts = plistOptions(rest, GREP_OPTIONS);
			return grepOf(value, pattern, {
				group: opts.has("group") ? intOption(opts, "group", 0) : undefined,
				max: intOption(opts, "max", Number.MAX_SAFE_INTEGER),
				ignoreCase: boolOption(opts, "ignore-case", true),
			});
		},
		GREP_ARGS,
	);
}

// The optional positional count of `head`/`tail`: elements for a list, words
// for text, so the default depends on the argument's type.
function countArg(rest: List, value: unknown, wordLimit: number): number {
	if (rest === null)
		return listElements(value) === undefined ? wordLimit : DEFAULT_ITEMS;
	const raw = rest.car;
	const n = typeof raw === "bigint" ? Number(raw) : raw;
	if (typeof n !== "number" || !Number.isInteger(n) || n < 0)
		throw new EvalException("non-negative integer expected", raw);
	return n;
}

/*
 * Install `echo`, `head`, `tail` and `grep` over `compressor`.
 *
 * The host passes the same `Compressor` it renders results with, and creates a
 * new one per interpreter: the naming counters must die with the globals they
 * named, or a `reset()` leaves the count climbing past unbound names. (This is
 * the opposite of `secretsExtension`, whose store is host configuration and
 * must survive a reset.)
 */
export function compressionExtension(
	compressor: Compressor = new Compressor(),
): InterpExtension {
	return (interp: Interp): void => registerCompression(interp, compressor);
}
