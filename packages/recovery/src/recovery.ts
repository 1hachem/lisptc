import type { Doc } from "@repo/interpreter/docs";
import { EvalException } from "@repo/interpreter/errors";
import { type Interp, runAsync, runSync } from "@repo/interpreter/lisp";
import {
	Cell,
	jsonToLisp,
	LispKeyword,
	type List,
	newSym,
	Sym,
} from "@repo/interpreter/objects";
import { str } from "@repo/interpreter/print";
import { Reader } from "@repo/interpreter/reader";
import { zList } from "@repo/interpreter/schema";
import type {
	Admission,
	InterpExtension,
	Problem,
	SessionHooks,
} from "@repo/interpreter/session";
import type { PromptSource } from "@repo/shared/host";
import { formSpans } from "@repo/shared/lisp-forms";
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

const CONVERSATION = newSym("conversation");

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
      (macro (from to &rest options)
             (cons '_rename (cons (list 'quote from) (cons (list 'quote to) options)))))
(setq close-parens (macro (&rest options) (cons '_close-parens options)))
(setq add-arg
      (macro (name key value &rest options)
             (cons '_add-arg
                   (cons (list 'quote name)
                         (cons (list 'quote key) (cons (list 'quote value) options))))))
(setq push-arg
      (macro (name value &rest options)
             (cons '_push-arg
                   (cons (list 'quote name) (cons (list 'quote value) options)))))
`;

const MACRO_DOCS: Record<string, Doc> = {
	rename: {
		signature: "(rename old new [:in form])",
		doc: "Rename the symbol old to new in the form, leaving strings alone.",
	},
	"close-parens": {
		signature: "(close-parens [:in form])",
		doc: "Close every parenthesis the form leaves open, at its end.",
	},
	"add-arg": {
		signature: "(add-arg f :key value [:in form])",
		doc: "Add a keyword argument to the one call of f in the form.",
	},
	"push-arg": {
		signature: "(push-arg f value [:in form])",
		doc: "Add a positional argument to the one call of f in the form, before its keyword arguments.",
	},
};

const EDIT_FIRST = [
	"edit rejected instead of rewriting it:",
	'(revise :old "text" :new "text") (rename old new) (close-parens) (add-arg f :key value) (push-arg f value)',
	"each edits the last failed form; pick another with :in, from (failed-forms).",
	"rewrite only when no edit can say it.",
].join("\n");

const EDITED = "edited the code the check stopped";

const ALONE =
	"edit forms change rejected and run alone: send them in a step with nothing else.";

interface FailedForm {
	form: number;
	line: number;
	text: string;
	problems: string[];
}

interface Stopped {
	code: string;
	problems: Problem[];
}

function itemsOf(list: unknown): unknown[] {
	const items: unknown[] = [];
	for (let p = list; p instanceof Cell; p = p.cdr as List) items.push(p.car);
	return items;
}

function field(record: unknown, key: string): unknown {
	for (const pair of itemsOf(record))
		if (pair instanceof Cell && pair.car === key) return pair.cdr;
	return undefined;
}

function problemOf(record: unknown): Problem {
	return {
		line: Number(field(record, "line")),
		message: String(field(record, "message") ?? ""),
	};
}

function lastStopped(conversation: unknown): Stopped | undefined {
	const entries = itemsOf(conversation);
	for (let at = entries.length - 1; at >= 0; at--) {
		const problems = itemsOf(field(entries[at], "problems"));
		if (problems.length === 0) continue;
		for (let before = at - 1; before >= 0; before--) {
			if (field(entries[before], "role") !== "assistant") continue;
			const code = field(entries[before], "content");
			return typeof code === "string"
				? { code, problems: problems.map(problemOf) }
				: undefined;
		}
		return undefined;
	}
	return undefined;
}

function lineAt(code: string, offset: number): number {
	return code.slice(0, offset).split("\n").length;
}

function failedForms({ code, problems }: Stopped): FailedForm[] {
	return formSpans(code).flatMap(([start, end], i) => {
		const first = lineAt(code, start);
		const last = lineAt(code, Math.max(start, end - 1));
		const inside = problems.filter((p) => p.line >= first && p.line <= last);
		if (inside.length === 0) return [];
		return [
			{
				form: i + 1,
				line: first,
				text: code.slice(start, end),
				problems: inside.map((p) => p.message),
			},
		];
	});
}

function editInForm(
	code: string,
	form: number,
	edit: (text: string) => string,
): string {
	const span = formSpans(code)[form - 1];
	if (span === undefined) throw new EditFailure(`rejected has no form ${form}`);
	const [start, end] = span;
	return code.slice(0, start) + edit(code.slice(start, end)) + code.slice(end);
}

function formNumberOf(record: unknown): number {
	const form = Number(field(record, "form"));
	if (!Number.isInteger(form) || form < 1)
		throw new EvalException(
			":in takes a form from (failed-forms), got",
			record ?? null,
		);
	return form;
}

class Edits {
	failure: string | undefined;
	fallback: number | undefined;

	constructor(private readonly interp: Interp) {}

	held(): string | null {
		const code = this.interp.getGlobal(REJECTED);
		return typeof code === "string" ? code : null;
	}

	hold(code: string | null): void {
		this.interp.defineGlobal(REJECTED, code, REJECTED_DOC);
	}

	stopped(): Stopped | undefined {
		return lastStopped(this.interp.getGlobal(CONVERSATION));
	}

	failed(): FailedForm[] {
		const stopped = this.stopped();
		return stopped === undefined ? [] : failedForms(stopped);
	}

	aim(): void {
		const stopped = this.stopped();
		this.fallback =
			stopped !== undefined && stopped.code === this.held()
				? failedForms(stopped).at(-1)?.form
				: undefined;
	}

	apply(target: unknown, edit: (code: string) => string): string {
		const code = this.held();
		try {
			if (code === null) throw new EditFailure("nothing was rejected to edit");
			const form = target === undefined ? this.fallback : formNumberOf(target);
			const edited =
				form === undefined ? edit(code) : editInForm(code, form, edit);
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

function positional(
	args: List,
	count: number,
): { values: unknown[]; target: unknown } {
	const values: unknown[] = [];
	let rest = args;
	for (let i = 0; i < count; i++) {
		if (!(rest instanceof Cell))
			throw new EvalException(`expected ${count} arguments, got`, args);
		values.push(rest.car);
		rest = rest.cdr as List;
	}
	return { values, target: keywordsOf(rest).get("in") };
}

function install(interp: Interp, edits: Edits): void {
	edits.hold(null);
	interp.def(
		"failed-forms",
		0,
		"(failed-forms)",
		"The forms of the last step the check stopped that it found problems in, last one last. Each is an alist with form, line, text and problems; hand one to an edit as :in.",
		z.tuple([]),
		() => jsonToLisp(edits.failed()),
	);
	interp.def(
		"revise",
		-1,
		'(revise :old "text" :new "text" [:in form])',
		"Replace text that occurs exactly once in the form. Fails on no match or several.",
		z.tuple([zList]),
		([args]) => {
			const keywords = keywordsOf(args);
			const old = textArgument(keywords, "old");
			const next = textArgument(keywords, "new");
			return edits.apply(keywords.get("in"), (code) =>
				replaceOnce(code, old, next),
			);
		},
	);
	interp.def(
		"_rename",
		-1,
		"(_rename 'old 'new [:in form])",
		"The edit rename expands to.",
		z.tuple([zList]),
		([args]) => {
			const { values, target } = positional(args, 2);
			const [from, to] = values;
			return edits.apply(target, (code) =>
				renameSymbol(code, source(from), source(to)),
			);
		},
	);
	interp.def(
		"_close-parens",
		-1,
		"(_close-parens [:in form])",
		"The edit close-parens expands to.",
		z.tuple([zList]),
		([args]) => edits.apply(positional(args, 0).target, closeParens),
	);
	interp.def(
		"_add-arg",
		-1,
		"(_add-arg 'f 'key 'value [:in form])",
		"The edit add-arg expands to.",
		z.tuple([zList]),
		([args]) => {
			const { values, target } = positional(args, 3);
			const [name, key, value] = values;
			return edits.apply(target, (code) =>
				addArgument(code, source(name), `${source(key)} ${source(value)}`),
			);
		},
	);
	interp.def(
		"_push-arg",
		-1,
		"(_push-arg 'f 'value [:in form])",
		"The edit push-arg expands to.",
		z.tuple([zList]),
		([args]) => {
			const { values, target } = positional(args, 2);
			const [name, value] = values;
			return edits.apply(target, (code) =>
				pushPositional(code, source(name), source(value)),
			);
		},
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
	edits.aim();
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
