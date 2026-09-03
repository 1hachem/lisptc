/*
 * Context compression for Lisptc.
 *
 * The REPL is an LLM's only interface, so everything it prints is spent
 * context. This module bounds that spend and makes the bound safe:
 *
 *  - Every top-level result is bound to a global named after the function that
 *    produced it — `linear/list-issues-1` — and echoed as `name = value`. The
 *    agent's next step refers to that name instead of retyping the data, which
 *    is both cheaper and the only way to be sure the value is exact.
 *  - What gets *printed* is capped at a word limit. Past the cap the text stops
 *    and a `...` line reports how much was shown, how much is left, and which
 *    name holds the whole thing.
 *  - `view` / `head` / `tail` / `grep` read into a value that was truncated (or
 *    into any other value — they take a value, not a handle).
 *
 * Truncating is only safe because of the naming: nothing is ever lost by not
 * printing it. See devdocs/compression.md.
 *
 * An opt-in extension, like src/secrets.ts: pass `compressionExtension()` in
 * `InterpOptions.extensions`. The `Compressor` holding the naming counters is
 * created by the host per interpreter, so `reset()` restarts numbering along
 * with the globals it named.
 */
import { z } from "zod";
import {
	type DocArg,
	EvalException,
	type Interp,
	type InterpExtension,
	newSym,
	Sym,
	str,
	zAny,
	zList,
} from "./lisp.ts";
import { plistOptions } from "./plist.ts";

// Words of a value the REPL will print before truncating. ~550 tokens, so a
// 25-step agent loop spends at most ~14k tokens echoing results.
export const MAX_WORDS = 400;

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
 * Text that prints as itself.
 *
 * `str`'s fallback branch renders an unrecognised object via `${x}`, so a
 * `toString` is all it takes to print verbatim — the same trick `Unspecified`
 * uses, and no change to the printer. `view`/`grep`/`head`/`tail` return this
 * rather than a plain string for two reasons: a string would come back
 * re-quoted and `\n`-escaped by `str` (destroying the marker), and it would
 * then be windowed a second time and given a nested marker of its own.
 */
export class RawText {
	constructor(readonly text: string) {}

	toString(): string {
		return this.text;
	}
}

/*
 * The one text a value is measured, windowed and searched over.
 *
 * A word offset only means anything if truncation and `view` agree on the
 * string they are counting, so both go through here. Strings render raw rather
 * than through `str` because `str` escapes newlines as a literal `\n`, which
 * turns a long document into one unreadable line.
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
 * A rendered top-level result: what to print, and the name it was bound to.
 *
 * A host evaluating several forms echoes only the last of them — the cap is per
 * eval, not per form — but every form still bound a name, so it needs the names
 * of the ones it is not printing (see `alsoSaved`).
 */
export interface Echo {
	text: string;
	name?: string;
}

interface Slice {
	text: string;
	above: number;
	shown: number;
	below: number;
	total: number;
	// The single word at `offset` exceeded the character budget on its own and
	// was hard-cut. Word offsets cannot page past it, so the marker has to
	// point at `substring` instead of `view`.
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

// The `...` line closing a truncated top-level result or output buffer.
function savedMarker(s: Slice, name: string, saved: boolean): string {
	const where = saved
		? `Full value saved in ${name}`
		: `Full value is in ${name}`;
	return `... ${position(s)}. ${where} — read on with ${readOn(s, name)}, or search it with (grep ${name} "pattern")`;
}

// The call that reads the next window. A hard-cut word has no next word offset
// to jump to, so slice it by character with the prelude's `substring` instead.
function readOn(s: Slice, name: string): string {
	if (s.cut)
		return `(substring ${name} ${s.chars} ${Math.min(s.totalChars, s.chars * 2)})`;
	return `(view ${name} :offset ${s.above + s.shown})`;
}

// The `...` line closing a `view`/`head`/`tail` window. `name` is absent when
// the value being viewed is not bound to any global, leaving nothing to name in
// the follow-up call.
function windowMarker(s: Slice, name: string | undefined): string {
	if (s.above === 0 && s.below === 0 && !s.cut) return "";
	if (s.cut)
		return `... ${position(s)} — ${
			name === undefined
				? `slice it by character with substring, from ${s.chars}`
				: `read on with ${readOn(s, name)}`
		}`;
	const atEnd = s.below === 0;
	const next = atEnd ? 0 : s.above + s.shown;
	const verb = atEnd ? "back to the start with" : "next";
	const how =
		name === undefined
			? `${atEnd ? "back to the start at" : "read on from"} :offset ${next}`
			: `${verb} (view ${name} :offset ${next})`;
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
 * Naming counters for one interpreter, plus every render entry point.
 *
 * Holds no values: a named result is an ordinary global, which is what lets
 * `view`/`grep` take a value rather than a handle and work just as well on data
 * the agent bound itself.
 */
export class Compressor {
	private readonly counters = new Map<string, number>();
	readonly limit: number;

	constructor(limit: number = MAX_WORDS) {
		this.limit = limit;
	}

	private get charBudget(): number {
		return this.limit * MAX_CHARS_PER_WORD;
	}

	/*
	 * Echo a top-level result as `name = value`, truncated if it overflows.
	 *
	 * The name is the point of the exercise: an agent that can refer to
	 * `linear/list-issues-1` never has to retype the data, which is where both
	 * the token spend and the hallucinated-value risk live.
	 */
	value(interp: Interp, form: unknown, value: unknown): Echo {
		if (value instanceof RawText) return { text: `${value.text}\n` };
		// `(defun f …)` returns the symbol it defined. Echoing `f = f` says
		// nothing twice; the binding it made is the result.
		if (value instanceof Sym && interp.hasGlobal(value))
			return { text: `${str(value)}\n`, name: value.name };
		// nil and t carry nothing a later step could want to refer to, and
		// every side-effecting loop returns nil — naming those would bury the
		// results that matter under `dotimes-1 = nil`.
		if (value === null || value === true) return { text: `${str(value)}\n` };

		const text = canonical(value);
		const spans = wordSpans(text);
		const { name, saved } = this.nameFor(interp, form, value);
		const s = sliceWords(text, spans, 0, this.limit, this.charBudget);
		// Under the cap the value prints through `str` as it always has, so a
		// short string stays quoted and re-readable; only a truncated one falls
		// back to its raw text (which is what `view` will show).
		if (s.below === 0 && !s.cut)
			return { text: `${name} = ${str(value)}\n`, name };
		return {
			text: `${name} = ${s.text}\n${savedMarker(s, name, saved)}\n`,
			name,
		};
	}

	/*
	 * Cap the side-effect output a program printed via princ/print/terpri.
	 *
	 * A print loop floods the context just as effectively as a large return
	 * value. The full text is saved as a string global because the call that
	 * produced it may not be repeatable.
	 */
	output(interp: Interp, text: string): string {
		if (text === "") return "";
		const spans = wordSpans(text);
		const s = sliceWords(text, spans, 0, this.limit, this.charBudget);
		if (s.below === 0 && !s.cut) return text;
		const name = this.bind(interp, "output", text, s.total);
		return `${s.text}\n${savedMarker(s, name, true)}\n`;
	}

	// Cap a rendered error. Nothing is saved: an EvalException's message is
	// derived from a value the program still has.
	error(text: string): string {
		const spans = wordSpans(text);
		const s = sliceWords(text, spans, 0, this.limit, this.charBudget);
		if (s.below === 0 && !s.cut) return text;
		return `${s.text}\n... ${position(s)} (error message truncated)\n`;
	}

	// `view` / `head` / `tail`.
	window(
		interp: Interp,
		value: unknown,
		offset: number,
		length: number,
	): RawText {
		const text = canonical(value);
		const spans = wordSpans(text);
		const s = sliceWords(
			text,
			spans,
			offset,
			Math.min(length, this.limit),
			this.charBudget,
		);
		const name = this.existingName(interp, value);
		const mark = windowMarker(s, name);
		if (s.shown === 0)
			return new RawText(
				`(nothing at :offset ${offset}; ${s.total} words in total)`,
			);
		return new RawText(mark === "" ? s.text : `${s.text}\n${mark}`);
	}

	// `tail`: the last `length` words.
	windowTail(interp: Interp, value: unknown, length: number): RawText {
		const total = wordSpans(canonical(value)).length;
		const take = Math.min(length, this.limit);
		return this.window(interp, value, Math.max(0, total - take), take);
	}

	/*
	 * `grep`: report each hit as `@<word-offset>` plus surrounding words.
	 *
	 * Offsets rather than line numbers because `str` of a large list is a single
	 * line with no newlines in it at all — a line-oriented grep would report one
	 * enormous match. A word window behaves the same on a one-line Lisp render
	 * and on multi-line text, and the offset it prints feeds straight back into
	 * `(view x :offset N)`.
	 */
	search(
		interp: Interp,
		value: unknown,
		pattern: string,
		options: { context: number; max: number; ignoreCase: boolean },
	): RawText {
		const text = canonical(value);
		const spans = wordSpans(text);
		const name = this.existingName(interp, value);

		let re: RegExp;
		try {
			re = new RegExp(pattern, options.ignoreCase ? "gi" : "g");
		} catch (ex) {
			throw new EvalException(
				`invalid regular expression (${ex instanceof Error ? ex.message : "unparseable"})`,
				pattern,
				false,
			);
		}

		const lines: string[] = [];
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
			if (lines.length >= options.max || printedWords >= this.limit) continue;

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
			coveredTo = to;
		}

		return new RawText(
			[
				...lines,
				searchSummary(
					found,
					skipped,
					lines.length,
					pattern,
					spans.length,
					name,
					scanned,
				),
			]
				.filter((l) => l !== "")
				.join("\n"),
		);
	}

	/*
	 * The name to echo a result under, minting one if the value has none.
	 *
	 * A value that is already reachable by a name reuses it rather than getting
	 * a second one. That is not a nicety: it is what makes `(setq issues (big))`
	 * report `issues`, and `(defun f …)` report `f`, without either needing to
	 * be special-cased by head symbol.
	 */
	private nameFor(
		interp: Interp,
		form: unknown,
		value: unknown,
	): { name: string; saved: boolean } {
		// A form that defined a global returns its symbol.
		if (value instanceof Sym && interp.hasGlobal(value))
			return { name: value.name, saved: false };

		const head = form instanceof Object && "car" in form ? form.car : undefined;

		// `(setq x …)` already put the value somewhere the agent can reach; the
		// name it assigned is the answer, whatever the value's type. Reverse
		// lookup below would only find it for a Cell or a string.
		if (head instanceof Sym && head.name === "setq") {
			const assigned = lastAssignedSymbol(form);
			if (assigned !== undefined) return { name: assigned, saved: false };
		}

		const existing = this.existingName(interp, value);
		if (existing !== undefined) return { name: existing, saved: false };

		const base = head instanceof Sym ? head.name : "result";
		const total = wordSpans(canonical(value)).length;
		return { name: this.bind(interp, base, value, total), saved: true };
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
			doc: `Saved result of a \`${base}\` call (${total} words). The REPL printed only part of it; this holds all of it. Read it with (view ${name}) or search it with (grep ${name} "pattern").`,
		});
		return name;
	}
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
	return `${parts.join(", ")}. Read a region with (view ${target} :offset <offset>)`;
}

/*
 * The line telling the model about results it was not shown.
 *
 * Without it a program of several forms silently binds names the model has no
 * way to learn short of `(dump)`.
 */
export function alsoSaved(names: readonly string[]): string {
	if (names.length === 0) return "";
	return `(also saved: ${names.join(", ")})\n`;
}

const VIEW_ARGS: DocArg[] = [
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
];

const GREP_ARGS: DocArg[] = [
	{
		name: "context",
		type: "integer",
		required: false,
		description: `words of context shown either side of a hit (default ${DEFAULT_CONTEXT})`,
	},
	{
		name: "max",
		type: "integer",
		required: false,
		description: `hits to print (default ${DEFAULT_MAX_HITS})`,
	},
	{
		name: "ignore-case",
		type: "boolean",
		required: false,
		description: "pass nil to match case-sensitively (default t)",
	},
];

function registerCompression(interp: Interp, c: Compressor): void {
	interp.def(
		"view",
		-2,
		"(view x [:offset 0] [:length n])",
		`Print a window of \`x\`, measured in whitespace-separated words: skip :offset words and show at most :length (default and maximum ${c.limit}). Ends with a \`...\` line saying how many words lie above and below and the offset to continue from. This is how you read a result the REPL truncated — the variable it named holds the whole value.`,
		z.tuple([zAny, zList]),
		([value, rest]) => {
			const opts = plistOptions(rest, ["offset", "length"]);
			return c.window(
				interp,
				value,
				intOption(opts, "offset", 0),
				intOption(opts, "length", c.limit),
			);
		},
		VIEW_ARGS,
	);

	interp.def(
		"head",
		-2,
		"(head x [:length n])",
		`Print the FIRST :length words of \`x\` (default ${c.limit}). This windows TEXT: it is not \`car\`, and on a list it shows the beginning of the printed form, not the first element.`,
		z.tuple([zAny, zList]),
		([value, rest]) => {
			const opts = plistOptions(rest, ["length"]);
			return c.window(interp, value, 0, intOption(opts, "length", c.limit));
		},
		[VIEW_ARGS[1] as DocArg],
	);

	interp.def(
		"tail",
		-2,
		"(tail x [:length n])",
		`Print the LAST :length words of \`x\` (default ${c.limit}). This windows TEXT: it is not \`cdr\`.`,
		z.tuple([zAny, zList]),
		([value, rest]) => {
			const opts = plistOptions(rest, ["length"]);
			return c.windowTail(interp, value, intOption(opts, "length", c.limit));
		},
		[VIEW_ARGS[1] as DocArg],
	);

	interp.def(
		"grep",
		-3,
		'(grep x "pattern" [:context 8] [:max 10] [:ignore-case t])',
		`Search \`x\` with \`pattern\`, a JavaScript-syntax regular expression, and print each hit as @<word-offset> followed by the surrounding words, with the match wrapped in [[ ]]. Feed a reported offset straight into (view x :offset <offset>) to read that region. Prefer this over \`view\` when you know what you are looking for. Case-insensitive unless you pass :ignore-case nil.`,
		z.tuple([zAny, zString, zList]),
		([value, pattern, rest]) => {
			const opts = plistOptions(rest, ["context", "max", "ignore-case"]);
			return c.search(interp, value, pattern, {
				context: intOption(opts, "context", DEFAULT_CONTEXT),
				max: intOption(opts, "max", DEFAULT_MAX_HITS),
				ignoreCase: boolOption(opts, "ignore-case", true),
			});
		},
		GREP_ARGS,
	);
}

/*
 * Install the read-more built-ins over `compressor`.
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
