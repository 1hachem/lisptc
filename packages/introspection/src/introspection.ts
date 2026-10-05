import { quotient } from "@repo/interpreter/arith";
import { lookupDoc } from "@repo/interpreter/docs";
import { callableArity, callableKind } from "@repo/interpreter/func";
import type { Interp } from "@repo/interpreter/lisp";
import {
	arrayToList,
	Cell,
	type List,
	newLispKeyword,
	newSym,
} from "@repo/interpreter/objects";
import { str } from "@repo/interpreter/print";
import { zAny, zString, zSym } from "@repo/interpreter/schema";
import type { InterpExtension } from "@repo/interpreter/session";
import { output } from "@repo/interpreter/topics";
import type { PromptSource } from "@repo/shared/host";
import { z } from "zod";

export interface IntrospectionHost {
	prompt: PromptSource;
}

export function introspectionExtension(
	host: IntrospectionHost,
): InterpExtension {
	return Object.assign(
		(interp: Interp): void => registerIntrospection(interp),
		{ prompt: host.prompt() },
	);
}

function arityList(f: unknown): List {
	const arity = callableArity(f);
	if (arity === undefined) return null;
	const max = arity.max === undefined ? null : quotient(arity.max, 1);
	return new Cell(quotient(arity.min, 1), new Cell(max, null));
}

function say(interp: Interp, text: string): void {
	output.emit(interp.channels, { user: text, model: text });
}

export function registerIntrospection(interp: Interp): void {
	interp.def(
		"arity",
		1,
		"(arity f)",
		"Return the arity of the function or macro `f` as `(min max)`, where `max` is nil when `f` takes a rest argument. Return nil when `f` is not callable.",
		z.tuple([zAny]),
		([f]) => arityList(f),
	);

	interp.def(
		"functionp",
		1,
		"(functionp x)",
		"Return t if `x` is a function, builtin or defined.",
		z.tuple([zAny]),
		([x]) => (callableKind(x) === "function" ? true : null),
	);

	interp.def(
		"macrop",
		1,
		"(macrop x)",
		"Return t if `x` is a macro.",
		z.tuple([zAny]),
		([x]) => (callableKind(x) === "macro" ? true : null),
	);

	interp.def(
		"signature",
		1,
		"(signature 'name)",
		"Return the documented signature of the binding `name` as a string, or nil if undocumented.",
		z.tuple([zSym]),
		([name]) => interp.docs().get(name.name)?.signature ?? null,
	);

	interp.def(
		"docstring",
		1,
		"(docstring 'name)",
		"Return the documentation of the binding `name` as a string, or nil if undocumented.",
		z.tuple([zSym]),
		([name]) => interp.docs().get(name.name)?.doc ?? null,
	);

	interp.def(
		"args",
		1,
		"(args 'name)",
		'Return the keyword arguments documented for `name`, one `(:key "type" required "description")` list each, `required` being t or nil and the description nil when absent. Return nil when `name` documents none.',
		z.tuple([zSym]),
		([name]) =>
			arrayToList(
				(interp.docs().get(name.name)?.args ?? []).map((arg) =>
					arrayToList([
						newLispKeyword(arg.name),
						arg.type,
						arg.required ? true : null,
						arg.description ?? null,
					]),
				),
			),
	);

	interp.def(
		"apropos",
		1,
		'(apropos "text")',
		"Return the sorted documented names whose name or documentation contains `text`, ignoring case.",
		z.tuple([zString]),
		([text]) => {
			const needle = text.toLowerCase();
			return arrayToList(
				[...interp.docs()]
					.filter(
						([name, entry]) =>
							!name.startsWith("_") &&
							(name.toLowerCase().includes(needle) ||
								entry.doc.toLowerCase().includes(needle)),
					)
					.map(([name]) => name)
					.sort()
					.map((name) => newSym(name)),
			);
		},
	);

	interp.def(
		"describe",
		1,
		"(describe 'name)",
		"Print what the binding `name` is: its kind, its arity when callable, its signature and its documentation. Return `name`, or nil if it is neither bound nor documented.",
		z.tuple([zSym]),
		([name]) => {
			const value = interp.getGlobal(name);
			const documented = interp.docs().has(name.name);
			if (value === undefined && !documented) {
				say(interp, `${name.name}: unbound\n`);
				return null;
			}
			const kind =
				value === undefined
					? "special form"
					: (callableKind(value) ?? "variable");
			const arity = arityList(value);
			const head = `${name.name}: ${kind}${arity === null ? "" : `, arity ${str(arity)}`}\n`;
			const body = documented
				? lookupDoc(interp, new Cell(name, null)).text
				: "";
			say(interp, head + body);
			return name;
		},
	);

	interp.def(
		"source",
		1,
		"(source 'name)",
		"Return the `defun` or `defmacro` form that last defined `name`, or nil when it was not defined by one.",
		z.tuple([zSym]),
		([name]) => interp.sourceOf(name.name) ?? null,
	);
}
