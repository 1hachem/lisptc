import { z } from "zod";
import { type Channels, MODEL, USER } from "./channels.ts";
import {
	Cell,
	callableKind,
	DOC_DOC,
	DOC_SIGNATURE,
	type DocArg,
	EvalException,
	echoText,
	type Interp,
	type InterpExtension,
	type List,
	lookupDoc,
	newSym,
	Sym,
	str,
	Unspecified,
	zAny,
	zList,
} from "./lisp.ts";
import { plistOptions, splitKeywordArgs } from "./plist.ts";
import { type PromptSection, prompted, promptSection } from "./prompt.ts";

export const MAX_WORDS = 400;

export const COMPACTION_PROMPT: PromptSection = promptSection(
	"compaction",
	new URL("./compaction.ptc", import.meta.url),
);

const INLINE_WORDS = 10;

const DEFAULT_ITEMS = 10;

const MAX_CHARS_PER_WORD = 12;

const MAX_MATCHES_SCANNED = 10_000;

const DEFAULT_CONTEXT = 8;
const DEFAULT_MAX_HITS = 10;

const zString = z.custom<string>(
	(x) => typeof x === "string",
	"string expected",
);

function canonical(x: unknown): string {
	return typeof x === "string" ? x : str(x);
}

function wordSpans(text: string): [number, number][] {
	const spans: [number, number][] = [];
	const re = /\S+/g;
	for (let m = re.exec(text); m !== null; m = re.exec(text))
		spans.push([m.index, m.index + m[0].length]);
	return spans;
}

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
	cut: boolean;
	chars: number;
	totalChars: number;
}

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

function position(s: Slice): string {
	if (s.cut)
		return `${s.chars} of ${s.totalChars} characters shown (one unbroken word)`;
	const parts = [`${s.shown} of ${s.total} words shown`];
	if (s.above > 0) parts.push(`${s.above} above`);
	if (s.below > 0) parts.push(`${s.below} below`);
	return parts.join(", ");
}

function echoMarker(s: Slice, name: string | undefined): string {
	if (s.above === 0 && s.below === 0 && !s.cut) return "";
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

function boolOption(
	opts: Map<string, unknown>,
	name: string,
	fallback: boolean,
): boolean {
	if (!opts.has(name)) return fallback;
	return opts.get(name) !== null;
}

export class Compactor {
	private readonly counters = new Map<string, number>();
	private spent = 0;
	private dropped = 0;
	private channels?: Channels;
	private stepping = false;
	readonly limit: number;

	constructor(limit: number = MAX_WORDS) {
		this.limit = limit;
	}

	private get charBudget(): number {
		return this.limit * MAX_CHARS_PER_WORD;
	}

	result(interp: Interp, form: unknown, value: unknown): string {
		if (!this.stepping) return "";
		if (value === Unspecified) return "";
		if (isDocForm(form)) return "";
		if (isReadForm(form)) {
			this.print(interp, value);
			return "";
		}
		if (value === null || value === true) return `${str(value)}\n`;
		if (value instanceof Sym && interp.hasGlobal(value))
			return `${value.name}: ${describe(interp.getGlobal(value))}\n`;

		const name = this.nameFor(interp, form, value);
		if (value instanceof Promise)
			return `${name}: a promise, still running. Its result applies itself when the promise settles, so nothing is owed here; to act on it use the name — (promise-state ${name}) checks it, (await ${name}) waits for it now, (cancel ${name}) aborts it.\n`;

		return `${name}: ${describe(value)}\n`;
	}

	beginStep(): void {
		this.stepping = true;
		this.spent = 0;
		this.dropped = 0;
	}

	reset(): void {
		this.counters.clear();
		this.stepping = false;
		this.spent = 0;
		this.dropped = 0;
	}

	attach(channels: Channels): void {
		this.channels = channels;
	}

	endStep(): string {
		if (this.dropped === 0) return "";
		return `... ${this.dropped} more word${this.dropped === 1 ? "" : "s"} of echo output not shown to you (a step may echo ${this.limit} words); echo less, or echo a named value you can page through\n`;
	}

	private get remaining(): number {
		return Math.max(0, this.limit - this.spent);
	}

	private echo(model: string, user: string, dropped: number): Bounded {
		this.spent += wordSpans(model).length;
		this.dropped += dropped;
		this.say({ model, user });
		return { model, user };
	}

	say(bounded: Bounded): void {
		if (bounded.user !== "")
			this.channels?.emit({ channel: USER, text: bounded.user });
		if (bounded.model !== "")
			this.channels?.emit({ channel: MODEL, text: bounded.model });
	}

	doc(text: string): Bounded {
		const bounded = { model: text, user: text };
		this.say(bounded);
		return bounded;
	}

	private print(interp: Interp, value: unknown): void {
		this.window(
			interp,
			echoText(new Cell(value, null)),
			value,
			0,
			Number.MAX_SAFE_INTEGER,
		);
	}

	error(text: string): Bounded {
		const spans = wordSpans(text);
		const s = sliceWords(text, spans, 0, this.limit, this.charBudget);
		if (s.below === 0 && !s.cut) return { model: text, user: text };
		return {
			model: `${s.text}\n... ${position(s)} (error message truncated)\n`,
			user: text,
		};
	}

	window(
		interp: Interp,
		text: string,
		value: unknown,
		offset: number,
		length: number,
	): Bounded {
		const spans = wordSpans(text);
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
		if (shown.shown === 0) return this.echo("", user, asked.shown);
		const mark = echoMarker(shown, name);
		return this.echo(
			mark === "" ? `${shown.text}\n` : `${shown.text}\n${mark}\n`,
			user,
			0,
		);
	}

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
		let shownToModel = 0;
		let found = 0;
		let scanned = 0;
		let skipped = 0;
		let printedWords = 0;
		let coveredTo = -1;

		for (let m = re.exec(text); m !== null; m = re.exec(text)) {
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

		const user = render(lines);
		return this.echo(render(lines.slice(0, shownToModel)), user, 0);
	}

	private nameFor(interp: Interp, form: unknown, value: unknown): string {
		if (value instanceof Sym && interp.hasGlobal(value)) return value.name;

		const head = form instanceof Object && "car" in form ? form.car : undefined;

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

	private existingName(interp: Interp, value: unknown): string | undefined {
		if (!(value instanceof Object) && typeof value !== "string")
			return undefined;
		if (value instanceof Sym) return undefined;
		for (const [sym, bound] of interp.globalEntries())
			if (bound === value) return sym.name;
		return undefined;
	}

	private bind(
		interp: Interp,
		base: string,
		value: unknown,
		total: number,
	): string {
		let n = (this.counters.get(base) ?? 0) + 1;
		let name = `${base}-${n}`;
		while (interp.hasGlobal(newSym(name))) name = `${base}-${++n}`;
		this.counters.set(base, n);
		interp.defineGlobal(newSym(name), value, {
			signature: name,
			doc: !(value instanceof Promise)
				? `Saved result of a \`${base}\` call (${total} words). The REPL reported its shape rather than printing it; this holds the whole value. Compute over it — (length ${name}), mapcar, assoc — or pull out what you need with (grep ${name} "pattern") or (head ${name} n). To look at it, (echo ${name}).`
				: `The promise a \`${base}\` call returned. This name is how you address it — its printed form (#<promise>) cannot be read back. It applies its own result when it settles, so awaiting is optional: (await ${name}) waits for it now and returns that result, (promise-state ${name}) checks it without blocking (:pending / :fulfilled / :rejected), (cancel ${name}) aborts it.`,
		});
		return name;
	}
}

const READ_FORMS = new Set([
	"head",
	"tail",
	"list-mcps",
	"list-toolkit",
	"list-tools",
	"search-mcps",
	"search-tools",
]);

function isReadForm(form: unknown): boolean {
	if (!(form instanceof Cell) || !(form.car instanceof Sym)) return false;
	return READ_FORMS.has(form.car.name);
}

function isDocForm(form: unknown): boolean {
	return (
		form instanceof Cell && form.car instanceof Sym && form.car.name === "doc"
	);
}

function lastAssignedSymbol(form: unknown): string | undefined {
	let arg: unknown = form instanceof Object && "cdr" in form ? form.cdr : null;
	let last: string | undefined;
	for (let i = 0; arg instanceof Object && "car" in arg; i++) {
		if (i % 2 === 0 && arg.car instanceof Sym) last = arg.car.name;
		arg = "cdr" in arg ? arg.cdr : null;
	}
	return last;
}

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

function listElements(x: unknown): unknown[] | undefined {
	if (x === null) return [];
	if (!(x instanceof Cell)) return undefined;
	const out: unknown[] = [];
	const seen = new Set<Cell>();
	for (let p: unknown = x; p instanceof Cell; p = p.cdr) {
		if (seen.has(p)) break;
		seen.add(p);
		out.push(p.car);
	}
	return out;
}

function toList(items: readonly unknown[]): List {
	let out: List = null;
	for (let i = items.length - 1; i >= 0; i--) out = new Cell(items[i], out);
	return out;
}

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
		if (m.index === re.lastIndex) re.lastIndex++;
		if (++scanned > MAX_MATCHES_SCANNED) break;
		const picked = options.group === undefined ? m[0] : m[options.group];
		if (picked !== undefined) hits.push(picked);
		if (hits.length >= options.max) break;
	}
	return toList(hits);
}

function describe(value: unknown): string {
	const callable = callableKind(value);
	if (callable !== undefined) return callable;

	if (value instanceof Promise) return "a promise, still running";

	const started = listElements(value);
	if (
		started !== undefined &&
		started.length > 0 &&
		started.every((p) => p instanceof Promise)
	)
		return `list of ${started.length} promise${started.length === 1 ? "" : "s"}, still running`;

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

function registerCompaction(interp: Interp, c: Compactor): void {
	interp.prompts.add(COMPACTION_PROMPT);
	c.reset();
	c.attach(interp.channels);

	interp.hooks.evalForm.use(function* (interp, form, next) {
		const value = yield* next(interp, form);
		const report = c.result(interp, form, value);
		if (report !== "") c.say({ model: report, user: report });
		return value;
	});
	interp.def(
		"doc",
		-1,
		DOC_SIGNATURE,
		`${DOC_DOC} Documentation is quoted back to you whole, however long it is, and reading it does not spend the step's ${c.limit} echo words — so look a binding up whenever you are unsure of it.`,
		z.tuple([zList]),
		([rest]) => {
			const answer = lookupDoc(interp, rest);
			c.doc(answer.text);
			return answer.value;
		},
	);
	interp.def(
		"echo",
		-1,
		'(echo x... [:offset 0] [:length n] [:match "re"] [:context 8] [:max 10] [:ignore-case t])',
		`Print the arguments, separated by spaces and followed by a newline: strings as they are, everything else in re-readable form. Output is measured in whitespace-separated words and stops after ${c.limit} of them, closing with a \`...\` line saying how much is left and the offset to continue from. :offset and :length choose the window. :match prints only the regions matching a JavaScript-syntax regular expression, each as @<word-offset> with the match wrapped in [[ ]] — that is how you read a value you cannot yet name a pattern for; to KEEP what matched rather than look at it, use \`grep\`, which returns it. A keyword prints as itself when it is the last argument — (echo (promise-state p)) — since only a keyword carrying a value after it is read as an option. Returns an unspecified value, so a step ending in an echo gets no result line: what was printed IS the report.`,
		z.tuple([zList]),
		([rest]) => {
			const { values, options } = splitKeywordArgs(rest, ECHO_OPTIONS);
			const opts = plistOptions(options, ECHO_OPTIONS);
			const text = echoText(values);
			const single =
				values !== null && values.cdr === null ? values.car : undefined;
			const pattern = opts.get("match");
			if (pattern !== undefined) {
				if (typeof pattern !== "string")
					throw new EvalException("string expected for :match", pattern);
				c.search(interp, text, single, pattern, {
					context: intOption(opts, "context", DEFAULT_CONTEXT),
					max: intOption(opts, "max", DEFAULT_MAX_HITS),
					ignoreCase: boolOption(opts, "ignore-case", true),
				});
				return Unspecified;
			}
			c.window(
				interp,
				text,
				single,
				intOption(opts, "offset", 0),
				intOption(opts, "length", Number.MAX_SAFE_INTEGER),
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

function countArg(rest: List, value: unknown, wordLimit: number): number {
	if (rest === null)
		return listElements(value) === undefined ? wordLimit : DEFAULT_ITEMS;
	const raw = rest.car;
	const n = typeof raw === "bigint" ? Number(raw) : raw;
	if (typeof n !== "number" || !Number.isInteger(n) || n < 0)
		throw new EvalException("non-negative integer expected", raw);
	return n;
}

export interface CompactionExtension extends InterpExtension {
	readonly compactor: Compactor;
}

export function compactionExtension(
	compactor: Compactor = new Compactor(),
): CompactionExtension {
	return Object.assign(
		prompted(
			(interp: Interp): void => registerCompaction(interp, compactor),
			[COMPACTION_PROMPT],
		),
		{ compactor },
	);
}

export function compactorOf(extension: InterpExtension): Compactor | undefined {
	const carried = (extension as Partial<CompactionExtension>).compactor;
	return carried instanceof Compactor ? carried : undefined;
}
