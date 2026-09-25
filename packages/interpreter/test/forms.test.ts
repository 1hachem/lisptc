import { FORM_FIXTURES } from "@repo/shared/lisp-form-fixtures";
import { formsOnly } from "@repo/shared/lisp-forms";
import { describe, expect, it } from "vitest";
import { Cell, Sym } from "../src/objects.ts";
import { Reader } from "../src/reader.ts";

const QUOTING = new Set(["quote", "quasiquote"]);
const UNQUOTING = new Set(["unquote", "unquote-splicing"]);

function callsIn(form: unknown, quoted: boolean, found: string[]): void {
	if (!(form instanceof Cell)) return;
	const head = form.car;
	if (head instanceof Sym && QUOTING.has(head.name)) {
		callsIn(nth(form, 1), true, found);
		return;
	}
	if (head instanceof Sym && UNQUOTING.has(head.name)) {
		callsIn(nth(form, 1), false, found);
		return;
	}
	if (!quoted && head instanceof Sym) found.push(head.name);
	for (let rest: unknown = form; rest instanceof Cell; rest = rest.cdr)
		callsIn(rest.car, quoted, found);
}

function nth(form: Cell, i: number): unknown {
	let rest: unknown = form;
	for (let n = 0; n < i && rest instanceof Cell; n++) rest = rest.cdr;
	return rest instanceof Cell ? rest.car : null;
}

function calls(source: string): string[] {
	const tokens = new Reader();
	tokens.push(formsOnly(source));
	const found: string[] = [];
	while (!tokens.isEmpty()) callsIn(tokens.read(), false, found);
	return [...new Set(found)];
}

describe("the calls the reader finds in what the scanner kept", () => {
	it.each(FORM_FIXTURES)("$source", ({ source, heads }) => {
		expect(calls(source)).toEqual(heads);
	});
});
