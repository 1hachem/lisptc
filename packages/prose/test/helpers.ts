import { ConversationInterpreter } from "@repo/interpreter/conversation";
import { effect, ends } from "@repo/interpreter/effects";
import { bufferSink, hitch } from "@repo/interpreter/journal";
import { boot, Interp, runAsync, runSync } from "@repo/interpreter/lisp";
import { str } from "@repo/interpreter/print";
import { openSession } from "@repo/interpreter/session";
import type { FormSpan } from "@repo/shared/lisp-forms";
import type { ProseHost } from "../src/ports.ts";
import { proseExtension } from "../src/prose.ts";
import { proseHost } from "../src/prose-host.ts";

function installed(host: ProseHost = proseHost): Interp {
	return new Interp({ extensions: [proseExtension(host)] });
}

const template = installed();
const beforePrelude = new Map(template.globalEntries());
boot(template);
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
	boot(interp);
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
	const buffer = bufferSink();
	const detach = interp.journal.pipe(buffer);
	try {
		return {
			value: str(runSync(interp, code)),
			output: buffer.collectText("user"),
		};
	} finally {
		detach();
	}
}

export function collectSkips(interp: Interp): string[] {
	const skipped: string[] = [];
	interp.journal.on(hitch, (n) => {
		if (n.kind === "skipped") skipped.push(n.text);
	});
	return skipped;
}

export function tolerantly(
	text: string,
	interp: Interp = proseInterp(),
): { value: string; output: string; skipped: string[] } {
	const skipped = collectSkips(interp);
	const buffer = bufferSink();
	const detach = interp.journal.pipe(buffer);
	try {
		return {
			value: str(runSync(interp, text)),
			output: buffer.collectText("user"),
			skipped,
		};
	} finally {
		detach();
	}
}

export function unrunSpans(text: string): FormSpan[] {
	const hooks = openSession([proseExtension(proseHost)]);
	return hooks.unrun
		.run(() => [], proseInterp(), text)
		.map((skipped) => skipped.span);
}

export async function endsTurn(reply: string): Promise<boolean> {
	const extension = proseExtension(proseHost);
	const interp = new ConversationInterpreter({ extensions: [extension] });
	boot(interp);
	const hooks = openSession([extension]);
	const buffer = bufferSink();
	const detach = interp.journal.pipe(buffer);
	try {
		await hooks.evalStep.run(
			async () => {
				await runAsync(interp, reply);
			},
			{ interp, code: reply, author: "assistant" },
		);
	} finally {
		detach();
	}
	return ends(buffer.collect(effect));
}
