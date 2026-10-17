import type { Doc } from "@repo/interpreter/docs";
import { EvalException } from "@repo/interpreter/errors";
import { type Interp, runAsync, runSync } from "@repo/interpreter/lisp";
import {
	Cell,
	LispKeyword,
	type List,
	newSym,
	Sym,
} from "@repo/interpreter/objects";
import { str } from "@repo/interpreter/print";
import { Reader } from "@repo/interpreter/reader";
import { zAny, zList } from "@repo/interpreter/schema";
import type {
	Admission,
	InterpExtension,
	SessionHooks,
} from "@repo/interpreter/session";
import type { PromptSource } from "@repo/shared/host";
import { z } from "zod";
import {
	addArgument,
	closeParens,
	EditFailure,
	pushPositional,
	renameSymbol,
	replaceOnce,
} from "./edits.ts";

export interface RecoveryHost {
	prompt: PromptSource;
}

const REJECTED = newSym("rejected");

const REJECTED_DOC: Doc = {
	signature: "rejected",
	doc: "The code of the last step the check stopped before it ran, or nil. Each edit form changes it.",
};

const EDIT_FORMS = new Set([
	"revise",
	"rename",
	"close-parens",
	"add-arg",
	"push-arg",
]);

const MACROS = `
(setq rename
      (macro (from to)
             (list '_rename (list 'quote from) (list 'quote to))))
(setq close-parens (macro () (list '_close-parens)))
(setq add-arg
      (macro (name key value)
             (list '_add-arg (list 'quote name) (list 'quote key) (list 'quote value))))
(setq push-arg
      (macro (name value)
             (list '_push-arg (list 'quote name) (list 'quote value))))
`;

const MACRO_DOCS: Record<string, Doc> = {
	rename: {
		signature: "(rename old new)",
		doc: "Rename the symbol old to new everywhere in rejected, leaving strings alone.",
	},
	"close-parens": {
		signature: "(close-parens)",
		doc: "Close every parenthesis rejected leaves open, at its end.",
	},
	"add-arg": {
		signature: "(add-arg f :key value)",
		doc: "Add a keyword argument to the one call of f in rejected.",
	},
	"push-arg": {
		signature: "(push-arg f value)",
		doc: "Add a positional argument to the one call of f in rejected, before its keyword arguments.",
	},
};

const EDIT_FIRST = [
	"edit rejected instead of rewriting it:",
	'(revise :old "text" :new "text") (rename old new) (close-parens) (add-arg f :key value) (push-arg f value)',
	"rewrite only when no edit can say it.",
].join("\n");

const EDITED = "edited the code the check stopped";

const ALONE =
	"edit forms change rejected and run alone: send them in a step with nothing else.";

class Edits {
	failure: string | undefined;

	constructor(private readonly interp: Interp) {}

	held(): string | null {
		const code = this.interp.getGlobal(REJECTED);
		return typeof code === "string" ? code : null;
	}

	hold(code: string | null): void {
		this.interp.defineGlobal(REJECTED, code, REJECTED_DOC);
	}

	apply(edit: (code: string) => string): string {
		const code = this.held();
		try {
			if (code === null) throw new EditFailure("nothing was rejected to edit");
			const edited = edit(code);
			this.hold(edited);
			return edited;
		} catch (ex) {
			if (!(ex instanceof EditFailure)) throw ex;
			this.failure = ex.message;
			throw new EvalException("edit failed", ex.message, false);
		}
	}
}

function source(form: unknown): string {
	return form instanceof Sym ? form.name : str(form, true);
}

function keywordsOf(args: List): Map<string, unknown> {
	const found = new Map<string, unknown>();
	for (let p = args; p !== null; p = (p.cdr as Cell | null)?.cdr as List) {
		const key = p.car;
		if (!(key instanceof LispKeyword) || !(p.cdr instanceof Cell))
			throw new EvalException("expected :keyword value pairs, got", key);
		found.set(key.name, p.cdr.car);
	}
	return found;
}

function textArgument(keywords: Map<string, unknown>, name: string): string {
	const value = keywords.get(name);
	if (typeof value !== "string")
		throw new EvalException(`:${name} must be a string, got`, value ?? null);
	return value;
}

function install(interp: Interp, edits: Edits): void {
	edits.hold(null);
	interp.def(
		"revise",
		-1,
		'(revise :old "text" :new "text")',
		"Replace text that occurs exactly once in rejected. Fails on no match or several.",
		z.tuple([zList]),
		([args]) => {
			const keywords = keywordsOf(args);
			const old = textArgument(keywords, "old");
			const next = textArgument(keywords, "new");
			return edits.apply((code) => replaceOnce(code, old, next));
		},
	);
	interp.def(
		"_rename",
		2,
		"(_rename 'old 'new)",
		"The edit rename expands to.",
		z.tuple([zAny, zAny]),
		([from, to]) =>
			edits.apply((code) => renameSymbol(code, source(from), source(to))),
	);
	interp.def(
		"_close-parens",
		0,
		"(_close-parens)",
		"The edit close-parens expands to.",
		z.tuple([]),
		() => edits.apply(closeParens),
	);
	interp.def(
		"_add-arg",
		3,
		"(_add-arg 'f 'key 'value)",
		"The edit add-arg expands to.",
		z.tuple([zAny, zAny, zAny]),
		([name, key, value]) =>
			edits.apply((code) =>
				addArgument(code, source(name), `${source(key)} ${source(value)}`),
			),
	);
	interp.def(
		"_push-arg",
		2,
		"(_push-arg 'f 'value)",
		"The edit push-arg expands to.",
		z.tuple([zAny, zAny]),
		([name, value]) =>
			edits.apply((code) => pushPositional(code, source(name), source(value))),
	);
	runSync(interp, MACROS);
	for (const [name, doc] of Object.entries(MACRO_DOCS))
		interp.setDoc(name, doc);
}

type StepKind = "edits" | "mixed" | "code";

function kindOf(interp: Interp, code: string): StepKind {
	const forms: unknown[] = [];
	const reader = new Reader();
	reader.push(interp.hooks.readSource.run((_i, text) => text, interp, code));
	try {
		while (!reader.isEmpty()) forms.push(reader.read());
	} catch {
		return "code";
	}
	const edits = forms.filter(
		(form) =>
			form instanceof Cell &&
			form.car instanceof Sym &&
			EDIT_FORMS.has(form.car.name),
	).length;
	if (edits === 0) return "code";
	return edits === forms.length ? "edits" : "mixed";
}

async function edited(
	interp: Interp,
	edits: Edits,
	code: string,
): Promise<string | Admission> {
	const before = edits.held();
	edits.failure = undefined;
	let thrown: unknown;
	try {
		await runAsync(interp, code);
	} catch (ex) {
		thrown = ex;
	}
	const failure =
		edits.failure ??
		(thrown === undefined
			? undefined
			: thrown instanceof Error
				? thrown.message
				: String(thrown));
	const after = edits.held();
	if (failure === undefined && after !== null) return after;
	edits.hold(before);
	return {
		code,
		rejected: `not run: ${failure ?? "nothing was rejected to edit"}\n${EDIT_FIRST}`,
	};
}

export function recoveryExtension(host: RecoveryHost): InterpExtension {
	const editsOf = new WeakMap<Interp, Edits>();
	const extension = (interp: Interp): void => {
		const edits = new Edits(interp);
		editsOf.set(interp, edits);
		install(interp, edits);
	};
	return Object.assign(extension, {
		prompt: host.prompt(),
		session(hooks: SessionHooks): void {
			hooks.admit.use(async (interp, code, next) => {
				const edits = editsOf.get(interp);
				if (edits === undefined) return next(interp, code);
				const kind = kindOf(interp, code);
				if (kind === "mixed") return { code, rejected: ALONE };
				const base = edits.held();
				let candidate = code;
				if (kind === "edits") {
					const result = await edited(interp, edits, code);
					if (typeof result !== "string") return result;
					candidate = result;
				}
				const checked = await next(interp, candidate);
				const admission =
					kind === "edits" && base !== null
						? { ...checked, because: EDITED, from: base }
						: checked;
				if (admission.rejected === undefined) {
					edits.hold(null);
					return admission;
				}
				edits.hold(admission.code);
				return {
					...admission,
					rejected: `${admission.rejected}\n${EDIT_FIRST}`,
				};
			});
		},
	});
}
