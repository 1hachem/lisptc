import { bufferTransport } from "@repo/interpreter/channels-host";
import { Interp, prelude, runSync, str } from "@repo/interpreter/lisp";
import { note } from "@repo/interpreter/topics";
import { type ProseHost, proseExtension } from "../src/prose.ts";

function installed(host?: ProseHost): Interp {
	return new Interp({ extensions: [proseExtension(host)] });
}

const template = installed();
const beforePrelude = new Map(template.globalEntries());
runSync(template, prelude);
const templateDocs = template.docs();

const builtinSymByValue = new Map(
	[...beforePrelude].map(([sym, value]) => [value, sym]),
);

const preludeGlobals = [...template.globalEntries()]
	.filter(([sym, value]) => beforePrelude.get(sym) !== value)
	.map(([sym, value]) => ({
		sym,
		value,
		aliasOf: builtinSymByValue.get(value),
		doc: templateDocs.get(sym.name),
	}));

export function proseInterp(host?: ProseHost): Interp {
	const interp = installed(host);
	for (const { sym, value, aliasOf, doc } of preludeGlobals)
		interp.defineGlobal(
			sym,
			aliasOf === undefined ? value : interp.getGlobal(aliasOf),
			doc,
		);
	return interp;
}

export function freshInterp(): Interp {
	const interp = new Interp();
	runSync(interp, prelude);
	return interp;
}

export function ev(code: string, interp: Interp = proseInterp()): string {
	return str(runSync(interp, code));
}

export function evProse(code: string, interp: Interp = proseInterp()): string {
	return ev(code, interp);
}

export function evWithOutput(
	code: string,
	interp: Interp = proseInterp(),
): { value: string; output: string } {
	const buffer = bufferTransport();
	const detach = interp.channels.pipe(buffer);
	try {
		return { value: str(runSync(interp, code)), output: buffer.text("user") };
	} finally {
		detach();
	}
}

export function collectSkips(interp: Interp): string[] {
	const skipped: string[] = [];
	note.on(interp.channels, (n) => {
		if (n.kind === "skipped") skipped.push(n.text);
	});
	return skipped;
}

export function tolerantly(
	text: string,
	interp: Interp = proseInterp(),
): { value: string; output: string; skipped: string[] } {
	const skipped = collectSkips(interp);
	const buffer = bufferTransport();
	const detach = interp.channels.pipe(buffer);
	try {
		return {
			value: str(runSync(interp, text)),
			output: buffer.text("user"),
			skipped,
		};
	} finally {
		detach();
	}
}
