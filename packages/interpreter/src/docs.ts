import { EvalException } from "./errors.ts";
import { type List, Sym } from "./objects.ts";

export interface DocSource {
	docs(): Map<string, Doc>;
}

export interface DocArg {
	name: string;
	type: string;
	required: boolean;
	description?: string;
}

export interface Arity {
	min: number;
	max?: number;
}

export interface Doc {
	signature: string;
	doc: string;
	args?: DocArg[];
}

export const specialFormDocs: Record<string, Doc> = {
	quote: {
		signature: "(quote x)",
		doc: "Return `x` unevaluated. `'x` is shorthand.",
	},
	progn: {
		signature: "(progn expr...)",
		doc: "Evaluate the expressions in order; return the last value.",
	},
	cond: {
		signature: "(cond (test expr...)...)",
		doc: "Evaluate each `test` in turn; for the first non-nil one, evaluate its body and return the last value (or the test's value if the body is empty). Returns nil if no test passes.",
	},
	setq: {
		signature: "(setq name value...)",
		doc: "Assign each `value` to the (global or lexical) variable `name`; return the last value.",
	},
	lambda: {
		signature: "(lambda (arg...) body...)",
		doc: "Create an anonymous function. The argument list may end with `&rest name` to collect remaining arguments as a list.",
	},
	macro: {
		signature: "(macro (arg...) body...)",
		doc: "Create a macro (only at the top level). Prefer `defmacro`.",
	},
	try: {
		signature: "(try body-form (catch (var) handler-form...))",
		doc: "Evaluate body-form. If it signals a catchable error (a built-in runtime error or a user `(error value)` call), bind var to the error's value and evaluate the handler forms, returning the last one; with no error, returns body-form's value directly. Does not catch break/return loop signals.",
	},
	t: { signature: "t", doc: "The canonical true value." },
	nil: { signature: "nil", doc: "The empty list / false value." },
};

export const DOC_SIGNATURE = "(doc [name])";

export const DOC_DOC =
	"With a symbol, print that binding's signature and description; return the symbol (nil if undocumented). With no argument, print every documented name.";

export interface DocAnswer {
	text: string;
	value: unknown;
}

export function lookupDoc(interp: DocSource, rest: List): DocAnswer {
	const docs = interp.docs();
	if (rest === null)
		return {
			text: [...docs.keys()]
				.sort()
				.map((key) => `${key}\n`)
				.join(""),
			value: true,
		};
	const name = rest.car;
	if (!(name instanceof Sym)) throw new EvalException("symbol expected", name);
	const entry = docs.get(name.name);
	if (entry === undefined)
		return { text: `${name.name}: undocumented\n`, value: null };
	const body = entry.doc
		.split("\n")
		.map((line) => (line ? `  ${line}` : line))
		.join("\n");
	return { text: `${entry.signature}\n${body}\n`, value: name };
}
