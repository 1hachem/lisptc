/*
 * Telling a model's sentences from its code.
 *
 * The reader already knows that only parenthesised top-level forms are program
 * text (`stripProse` in src/lisp.ts). What it cannot know is what to make of a
 * form that parses but was never meant as a call — `(see below)`, `(one, two,
 * three)`, `(50% done)` — which is what an LLM writes when the grammar that
 * would have stopped it (`lisptc.gbnf`) does not bind its provider.
 *
 * Deciding that is a guess about English, not a rule of the language, so it
 * lives here as an opt-in extension rather than in the core: pass
 * `proseExtension()` in `InterpOptions.extensions` and `run(..., { prose:
 * "tolerant" })` consults it once per top-level form. Without the extension
 * `tolerant` still reads an unclosed `(` as prose (that much is the reader's
 * own business) but every form it can parse is code, which is exactly right
 * for a host whose input is not model-written. A host that reads its model
 * differently passes its own `ProseClassifier` instead of replacing the core.
 */
import {
	Cell,
	type Interp,
	type InterpExtension,
	isSpecialForm,
	LispKeyword,
	Sym,
	str,
} from "./lisp.ts";

/*
 * Is this top-level form a sentence rather than a call? Returns the note to
 * report it with (see `RunOptions.onProse`), or undefined to evaluate it.
 *
 * Returning a note rather than a boolean keeps the whole "why" with the policy
 * that decided it: what the agent gets told is as much a judgement call as the
 * skip itself.
 */
export type ProseClassifier = (
	interp: Interp,
	form: unknown,
) => string | undefined;

// Install a prose classifier (the bundled `readsAsProse` unless given another).
export function proseExtension(
	classify: ProseClassifier = readsAsProse,
): InterpExtension {
	return (interp) => {
		interp.prose = classify;
	};
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

// Quote a fragment back to the caller without spending a screen on it.
function abbreviate(text: string): string {
	const oneLine = text.replace(/\s+/g, " ");
	return oneLine.length <= 60 ? oneLine : `${oneLine.slice(0, 57)}...`;
}
