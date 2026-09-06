/*
 * Telling a model's sentences from its code.
 *
 * The core already knows that only parenthesised top-level forms are program
 * text (`stripProse` in src/lisp.ts). What it does not know is what to make of
 * a parenthesis it cannot use — an unclosed `(` mid-sentence, a balanced one
 * holding markdown, a form that parses but was never meant as a call (`(see
 * below)`, `(one, two, three)`, `(50% done)`) — which is what an LLM writes
 * when the grammar that would have stopped it (`lisptc.gbnf`) does not bind
 * its provider. Reading those as prose rather than as broken code is this
 * module's whole subject.
 *
 * All of it is a guess about English, not a rule of the language, so all of it
 * lives here as an opt-in extension filling three of the core's reader hooks
 * (src/hooks.ts). Installing it is the whole of the choice: an interp built
 * with `proseExtension()` reads its input the way a model writes, and one
 * built without it reads everything as program text — an unclosed paren is a
 * truncated program and an unknown head an undefined name. There is no
 * per-call flag, because tolerance is a property of whose text this interp is
 * for, and that does not change between one `run` and the next.
 *
 * So a host wanting both keeps two interps rather than one interp and a
 * boolean. `checkSyntax` needs no interp at all and is strict by construction,
 * which is what keeps editor diagnostics honest.
 *
 * A host that reads its model differently passes its own `ProseClassifier`
 * rather than replacing the core.
 */
import {
	Cell,
	endOfForm,
	type Interp,
	type InterpExtension,
	isSpecialForm,
	LispKeyword,
	readFailure,
	Sym,
	str,
} from "./lisp.ts";

/*
 * Is this top-level form a sentence rather than a call? Returns the note to
 * report it with (see `RunOptions.onProse`), or undefined to evaluate it.
 *
 * This is the `skipForm` hook's answer, and the only one of the three that is
 * swappable: what counts as an unreadable parenthesis is a fact about the
 * reader, but what counts as a sentence is a claim about the writer.
 *
 * Returning a note rather than a boolean keeps the whole "why" with the policy
 * that decided it: what the agent gets told is as much a judgement call as the
 * skip itself.
 */
export type ProseClassifier = (
	interp: Interp,
	form: unknown,
) => string | undefined;

/*
 * Install the tolerant prose reader (classifying parsed forms with the bundled
 * `readsAsProse` unless given another).
 *
 * The three hooks are answered in the order the reader reaches them, which is
 * the order of how much is known: `unclosedForm` and `unreadableForm` are put
 * text that never became a form, `skipForm` only a form that parsed.
 *
 * An unclosed `(` is prose unconditionally, with no reasoning about the text at
 * all: a stray parenthesis in a sentence is far likelier from a model than a
 * truncated program, and reading it as one loses every form that came after it.
 * A host that has to tell those two apart asks `isTruncated` about the whole
 * reply instead.
 */
export function proseExtension(
	classify: ProseClassifier = readsAsProse,
): InterpExtension {
	return (interp) => {
		interp.hooks.unclosedForm.use(
			(text, at) => `unclosed "(" on line ${lineAt(text, at)}`,
		);
		interp.hooks.unreadableForm.use(
			(text, start, end, next) =>
				unreadable(text, start, end) ?? next(text, start, end),
		);
		interp.hooks.skipForm.use(
			(interp, form, next) => classify(interp, form) ?? next(interp, form),
		);
	};
}

/*
 * Why the balanced form spanning [start, end) cannot be read, as the note to
 * report the skip with — or undefined if it reads fine.
 *
 * Matching parentheses do not make text a program. Markdown's backticks are
 * quasiquote sugar here, so a model writing "(including a deprecated
 * `read_file`)" hands the reader a quasiquote whose operand is the closing
 * parenthesis, and the whole sentence dies as `unexpected ")"`. Nothing above
 * the reader can rescue it: the classifier is consulted once per PARSED form,
 * and this text never becomes one.
 */
function unreadable(
	text: string,
	start: number,
	end: number,
): string | undefined {
	const source = text.slice(start, end);
	const failure = readFailure(source);
	if (failure === undefined) return undefined;
	const line = lineAt(text, start) + failure.line - 1;
	return `${abbreviate(source)} — ${failure.reason} on line ${line}, so this was read as prose`;
}

export const readsAsProse: ProseClassifier = (interp, form) => {
	const head = proseHead(interp, form);
	if (head === undefined) return undefined;
	return `${abbreviate(str(form))} — "${head}" is not defined, so this was read as prose`;
};

/*
 * The head symbol of a top-level form to be read as prose rather than run.
 *
 * A head that names nothing this session knows is the mark of a sentence with
 * parentheses in it — `(see below)`, `(one, two, three)`, `(next step)` —
 * rather than a program: real code calls something that exists. Boundness is
 * the test, not callability, so calling a variable that holds a list stays an
 * ordinary "not applicable" error rather than being silently dismissed as
 * prose.
 *
 * But an unbound head only makes a form prose if the REST of the form could be
 * a sentence too, and two things say it could not:
 *
 * - it carries a mark of code (`marksCode`) — a keyword argument, a string
 *   literal, an argument that is itself a call to something defined;
 * - its head is namespaced (`isNamespaced`) and it hands that name no word to
 *   make a phrase of — `(server/tool)` is a call, `(A/B test)` is English.
 *
 * The case that forced this: a tool call whose server was never loaded,
 * `(server/tool :key "value")`. Reading that as a turn of phrase loses the
 * step in silence, and silence is the one failure the agent cannot debug — it
 * has to see that the name does not exist.
 *
 * What stays ambiguous is a misspelled word: `(lenght lst)` and `(step 2)` are
 * the same shape, so a typo with no literal in it is still read as prose and
 * reported as a skip rather than an error. Only a mark of code resolves it.
 *
 * Checked per form as the program runs, not up front: an earlier form may be
 * the `defun` that defines the head of a later one.
 */
function proseHead(interp: Interp, form: unknown): string | undefined {
	if (!(form instanceof Cell)) return undefined;
	const head = form.car;
	// A special form (`quote`, `setq`, …) is a keyword symbol, and a computed
	// head (`((lambda (x) x) 1)`) is not a symbol at all; both are program text.
	if (!(head instanceof Sym) || isSpecialForm(head)) return undefined;
	if (interp.hasGlobal(head)) return undefined;
	if (marksCode(interp, form)) return undefined;
	if (isNamespaced(head.name) && !hasWord(form)) return undefined;
	return head.name;
}

/*
 * Does the form carry something only code carries?
 *
 * - a keyword argument (`:url "…"`) — this dialect's call syntax, and nothing
 *   a sentence contains;
 * - a string literal — a value being passed, not a word being written, which
 *   is what separates the misspelled call `(string-splt "a,b" ",")` from the
 *   aside `(see below)`;
 * - an argument that is itself a call to something defined — `(fetch (car
 *   urls))` is code however unknown `fetch` is. Reader sugar does not count:
 *   `'t` and `,x` expand to `quote`/`unquote` heads, neither of them bound.
 */
function marksCode(interp: Interp, form: Cell): boolean {
	for (let rest: unknown = form.cdr; rest instanceof Cell; rest = rest.cdr) {
		const arg = rest.car;
		if (arg instanceof LispKeyword || typeof arg === "string") return true;
		if (arg instanceof Cell) {
			const inner = arg.car;
			if (
				inner instanceof Sym &&
				!isSpecialForm(inner) &&
				interp.hasGlobal(inner)
			)
				return true;
		}
	}
	return false;
}

// A name punctuated the way an identifier is and a word never is: a slash
// namespacing it (`server/tool`) or an underscore joining it (`browser_close`).
// Note how little else qualifies — `e.g.`, `50%`, `1,` and an emoji are all things
// a sentence writes, so the head's shape alone is never enough to call a form
// code (see `hasWord`).
function isNamespaced(name: string): boolean {
	return name.includes("/") || name.includes("_");
}

// Does the form hand its head a bare word rather than a value? That is what
// makes `(A/B test)` a phrase and leaves `(server/tool)` a call.
function hasWord(form: Cell): boolean {
	for (let rest: unknown = form.cdr; rest instanceof Cell; rest = rest.cdr)
		if (rest.car instanceof Sym) return true;
	return false;
}

/*
 * Does the text break off mid-form?
 *
 * The one unreadable reply that is not a sentence: an LLM cut off by a token
 * limit leaves a parenthesis open, and a host that ends its agent loop on
 * whatever ran nothing (see `AgentRepl`) would strand the task there. Every
 * other form that will not parse is prose to this reader, so that host wants
 * this question rather than `checkSyntax`'s — which cannot tell the two apart.
 *
 * It asks nothing of an interp: truncation is a property of the text, so a
 * host can ask it without having installed the extension at all.
 */
export function isTruncated(text: string): boolean {
	let i = 0;
	while (i < text.length) {
		if (text[i] !== "(") {
			i++;
			continue;
		}
		const end = endOfForm(text, i);
		if (end < 0) return true;
		i = end;
	}
	return false;
}

// The 1-based line character `at` falls on, for a message about it.
function lineAt(text: string, at: number): number {
	let line = 1;
	for (let i = 0; i < at; i++) if (text[i] === "\n") line++;
	return line;
}

// Quote a fragment back to the caller without spending a screen on it.
function abbreviate(text: string): string {
	const oneLine = text.replace(/\s+/g, " ");
	return oneLine.length <= 60 ? oneLine : `${oneLine.slice(0, 57)}...`;
}
