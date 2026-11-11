import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bufferTransport } from "@repo/interpreter/channels-host";
import { driveAsync, type Eval, settled } from "@repo/interpreter/drive";
import { restore, snapshot } from "@repo/interpreter/image";
import { journal } from "@repo/interpreter/journal";
import { runAsync, runSync } from "@repo/interpreter/lisp";
import { prelude } from "@repo/interpreter/prelude";
import { str } from "@repo/interpreter/print";
import { type InterpExtension, openSession } from "@repo/interpreter/session";
import { memoryKind } from "@repo/journal-catalog/memory";
import type { Clock } from "@repo/shared/host";
import { view } from "@repo/shared/journal";
import { describe, expect, it } from "vitest";
import {
	FORGET_BELOW,
	HALF_LIFE_MS,
	MAX_CASCADE_DEPTH,
	MAX_RECALL_WORDS,
	MemoryBank,
	memoryExtension,
	REINFORCEMENT,
} from "../src/memory.ts";
import {
	FileMemoryStore,
	memoryDirFor,
	scopedMemoryStore,
} from "../src/memory-host.ts";
import {
	LINKED_FIRES_AT,
	type Memory,
	type MemoryWrite,
	VolatileStore,
} from "../src/ports.ts";
import { bareHost, MemoryInterp, written } from "./helpers.ts";

function drive<T>(gen: Eval<T>): Promise<T> {
	return driveAsync(gen).then((outcome) => outcome.value);
}

interface Fixture {
	interp: MemoryInterp;
	bank: MemoryBank;
	step(code: string): Promise<string>;
}

function fixture(
	bank: MemoryBank = new MemoryBank(new VolatileStore()),
	extras: InterpExtension[] = [],
): Fixture {
	const interp = new MemoryInterp({
		extensions: [memoryExtension(bareHost, { bank }), ...extras],
	});
	runSync(interp, prelude);
	return {
		interp,
		bank,
		async step(code: string): Promise<string> {
			const fired = await drive(bank.hear(interp));
			const heard = fired.map((m) => `${m.key}: ${m.body}\n`).join("");
			const before = await drive(bank.beginStep(code, interp));
			await runAsync(interp, code);
			return heard + before + (await drive(bank.endStep()));
		},
	};
}

async function opening(f: Fixture): Promise<string> {
	const hooks = openSession([memoryExtension(bareHost, { bank: f.bank })]);
	await drive(
		hooks.beginStep.run(() => settled(undefined), { interp: f.interp }),
	);
	return f.interp
		.takeAppended()
		.map((note) => note.content)
		.join("");
}

async function ev(f: Fixture, code: string): Promise<string> {
	return str((await runAsync(f.interp, code)).value);
}

function said(f: Fixture, text: string): void {
	f.interp.seed([
		...f.interp.conversation.said(),
		{ role: "user", content: text },
	]);
}

function clockAt(ms: { now: number }): Clock {
	return { now: () => ms.now };
}

function remembered(f: Fixture, key: string): Promise<Memory | undefined> {
	return drive(f.bank.remembered(key));
}

function plain(key: string, lastUsed = 0): MemoryWrite {
	return written({
		key,
		body: "v",
		on: { kind: "when", pattern: "the test asks for it" },
		links: new Map(),
		score: 1,
		used: 0,
		lastUsed,
	});
}

const DECLARED_KEYS = "(mapcar (lambda (entry) (car entry)) *memories*)";

describe("remembering and recalling", () => {
	it("stores prose and hands it back on a matching query", async () => {
		const f = fixture();

		expect(
			await ev(
				f,
				'(memory/remember "linear-ids" "Ids look like ENG-12." :when "the test asks for it")',
			),
		).toBe('"linear-ids"');
		expect(
			await ev(f, '(cdr (assoc "body" (car (memory/recall "linear"))))'),
		).toBe('"Ids look like ENG-12."');
	});

	it("matches on the body as well as the key", async () => {
		const f = fixture();
		await ev(
			f,
			'(memory/remember "k" "the deploy runs on friday" :when "the test asks for it")',
		);

		expect(await ev(f, '(length (memory/recall "friday"))')).toBe("1");
	});

	it("forgives a misspelling in the query", async () => {
		const f = fixture();
		await ev(
			f,
			'(memory/remember "eng-12" "an issue" :when "the test asks for it")',
		);

		expect(await ev(f, '(length (memory/recall "isue"))')).toBe("1");
	});

	it("takes a prefix of a word in the body", async () => {
		const f = fixture();
		await ev(
			f,
			'(memory/remember "eng-12" "an issue" :when "the test asks for it")',
		);

		expect(await ev(f, '(length (memory/recall "iss"))')).toBe("1");
	});

	it("forgets on request", async () => {
		const f = fixture();
		await ev(f, '(memory/remember "k" "v" :when "the test asks for it")');

		expect(await ev(f, '(memory/forget "k")')).toBe("t");
		expect(await ev(f, '(memory/forget "k")')).toBe("nil");
		expect(await ev(f, "(length (memories))")).toBe("0");
	});

	it("forgets everything on request", async () => {
		const f = fixture();
		await ev(f, '(memory/remember "a" "one" :when "the test asks for it")');
		await ev(f, `(memory/remember "b" "two" :on '(start))`);

		expect(await ev(f, "(memory/forget-all)")).toBe("2");
		expect(await ev(f, "(length (memories))")).toBe("0");
		expect(await ev(f, "(memory/forget-all)")).toBe("0");
	});

	it("asks a human before forgetting everything", () => {
		expect(memoryExtension(bareHost).asks).toEqual(["memory/forget-all"]);
	});

	it("keeps a form as a form, not as its value", async () => {
		const f = fixture();
		await ev(
			f,
			'(memory/remember "triage" \'(defun triage (i) (cdr i)) :when "the test asks for it")',
		);

		expect(
			await ev(f, '(cdr (assoc "body" (car (memory/recall "triage"))))'),
		).toBe("(defun triage (i) (cdr i))");
	});

	it("refuses a body that cannot be read back", async () => {
		const f = fixture();

		await expect(
			ev(
				f,
				'(memory/remember "k" (lambda (x) x) :when "the test asks for it")',
			),
		).rejects.toThrow(/reads back/);
	});
});

describe("replay", () => {
	it("evaluates a remembered form, installing what it defines", async () => {
		const f = fixture();
		await ev(
			f,
			'(memory/remember "double" \'(defun double (x) (* x 2)) :when "the test asks for it")',
		);

		expect(await ev(f, '(memory/replay "double")')).toBe("double");
		expect(await ev(f, "(double 21)")).toBe("42");
	});

	it("says a prose memory has nothing to run", async () => {
		const f = fixture();
		await ev(
			f,
			'(memory/remember "k" "just words" :when "the test asks for it")',
		);

		await expect(ev(f, '(memory/replay "k")')).rejects.toThrow(/prose/);
	});
});

describe("triggers", () => {
	it("fires on a call, matched on the head of the form", async () => {
		const f = fixture();
		await ev(
			f,
			`(memory/remember "tools" "list first" :on '(call (string-join)))`,
		);

		expect(await f.step('(echo "hi")')).not.toContain("list first");
		expect(await f.step(`(string-join '("a") ",")`)).toContain(
			"tools: list first",
		);
	});

	it("records each memory it fires as a journal entry, when it fires", async () => {
		const f = fixture();
		await ev(f, `(memory/remember "always" "here" :on '(step))`);
		const buffer = bufferTransport();
		f.interp.channels.pipe(buffer);

		await f.step("(+ 1 1)");

		expect(view(buffer.collect(journal), memoryKind)).toEqual([
			{ key: "always", body: "here", on: "step" },
		]);
	});

	it("finds a call nested inside a binding form", async () => {
		const f = fixture();
		await ev(f, `(memory/remember "t" "note" :on '(call (concat)))`);

		expect(await f.step('(setq x (concat "a" "b"))')).toContain("t: note");
	});

	it("fires on every step when the trigger names no pattern", async () => {
		const f = fixture();
		await ev(f, `(memory/remember "always" "here" :on '(step))`);

		expect(await f.step("(+ 1 1)")).toContain("always: here");
	});

	it("fires on an error, surfacing what went wrong last time", async () => {
		const f = fixture();
		await ev(
			f,
			`(memory/remember "voids" "define it first" :on '(error "undefined"))`,
		);

		await drive(f.bank.beginStep("(nope)", f.interp));
		await expect(runAsync(f.interp, "(nope)")).rejects.toThrow(/undefined/);

		expect(await drive(f.bank.endStep())).toContain("voids: define it first");
	});

	it("matches what the user said by regular expression", async () => {
		const f = fixture();
		await ev(
			f,
			`(memory/remember "f" "docs live in /docs" :on '(user "file.*"))`,
		);

		said(f, "read file.md");
		expect(await f.step("(+ 1 1)")).toContain("f: docs live in /docs");
		said(f, "read file.pdf");
		expect(await f.step("(+ 1 1)")).toContain("f: docs live in /docs");
		said(f, "read the folder");
		expect(await f.step("(+ 1 1)")).not.toContain("f:");
	});

	it("honours an anchor in what the user said", async () => {
		const f = fixture();
		await ev(f, `(memory/remember "d" "note" :on '(user "^deploy"))`);

		said(f, "deploy the api");
		expect(await f.step("(+ 1 1)")).toContain("d: note");
		said(f, "do not deploy the api");
		expect(await f.step("(+ 1 1)")).not.toContain("d: note");
	});

	it("matches what the user said whatever its case", async () => {
		const f = fixture();
		await ev(f, `(memory/remember "c" "note" :on '(user "file.*"))`);

		said(f, "read FILE.MD");
		expect(await f.step("(+ 1 1)")).toContain("c: note");
	});

	it("reads a pattern that is no regular expression as plain text", async () => {
		const f = fixture();
		await ev(f, `(memory/remember "p" "note" :on '(user "c++"))`);

		said(f, "port it to c++ first");
		expect(await f.step("(+ 1 1)")).toContain("p: note");
	});

	it("combines regular expressions over what the user said", async () => {
		const f = fixture();
		await ev(
			f,
			`(memory/remember "m" "note" :on '(user (any-of "file.*" "doc.*")))`,
		);

		said(f, "open doc.txt");
		expect(await f.step("(+ 1 1)")).toContain("m: note");
		said(f, "open the drawer");
		expect(await f.step("(+ 1 1)")).not.toContain("m: note");
	});

	it("fires again when the user repeats the message word for word", async () => {
		const f = fixture();
		await ev(f, `(memory/remember "w" "note" :on '(user "world go"))`);

		said(f, "world go(done)");
		expect(await f.step("(+ 1 1)")).toContain("w: note");
		said(f, "world go(done)");
		expect(await f.step("(+ 1 1)")).toContain("w: note");
	});

	it("hands over what the user said before the step runs", async () => {
		const f = fixture();
		await ev(f, `(memory/remember "h" "note" :on '(user "world go"))`);

		said(f, "world go(done)");
		expect(await drive(f.bank.hear(f.interp))).toEqual([
			{ key: "h", body: "note", on: "user" },
		]);
		expect(await drive(f.bank.beginStep("(+ 1 1)", f.interp))).toBe("");
	});

	it("hands over a linked memory under its own trigger kind", async () => {
		const f = fixture();
		await ev(f, `(memory/remember "h" "note" :on '(user "world go"))`);
		await ev(
			f,
			'(memory/remember "plain" "linked note" :when "the test asks for it")',
		);
		const h = await remembered(f, "h");
		h?.links.set("plain", LINKED_FIRES_AT);
		if (h) await drive(f.bank.remember(h));

		said(f, "world go(done)");
		expect(await drive(f.bank.hear(f.interp))).toEqual([
			{ key: "h", body: "note", on: "user" },
			{ key: "plain", body: "linked note", on: "when" },
		]);
	});

	it("keeps a memory the user's words fired open for revision", async () => {
		const f = fixture();
		await ev(f, `(memory/remember "r" "old" :on '(user "world go"))`);

		said(f, "world go(done)");
		await f.step(`(memory/revise "r" "new")`);

		expect((await remembered(f, "r"))?.body).toBe("new");
	});

	it("fires once for a message however many steps a turn takes", async () => {
		const f = fixture();
		await ev(f, `(memory/remember "o" "note" :on '(user "world go"))`);

		said(f, "world go(done)");
		expect(await f.step("(+ 1 1)")).toContain("o: note");
		expect(await f.step("(+ 2 2)")).not.toContain("o: note");
	});

	it("refuses a memory without a hook, so none is stored that never comes back", async () => {
		const f = fixture();
		await expect(
			ev(f, '(memory/remember "untriggered" "a note")'),
		).rejects.toThrow(/needs a hook/);
		expect(await ev(f, "(memories)")).not.toContain("untriggered");
	});

	it("refuses a memory without a body", async () => {
		const f = fixture();
		await expect(
			ev(f, '(memory/remember "Call the user djaafer.")'),
		).rejects.toThrow(/needs a body/);
		await expect(
			ev(f, '(memory/remember "k" "  " :when "the test asks for it")'),
		).rejects.toThrow(/needs a body/);
	});

	it("fires only for the argument the trigger names", async () => {
		const f = fixture();
		await ev(
			f,
			`(memory/remember "pw" "browser_navigate, not navigate"
			   :on '(call (string-join "playwright")))`,
		);

		expect(await f.step(`(string-join '("linear") ",")`)).not.toContain("pw:");
		expect(await f.step(`(string-join '("playwright") ",")`)).toContain(
			"pw: browser_navigate",
		);
	});

	it("takes a bare call as any call to that name", async () => {
		const f = fixture();
		await ev(f, `(memory/remember "any" "note" :on '(call (string-join)))`);

		expect(await f.step(`(string-join '("linear") ",")`)).toContain(
			"any: note",
		);
	});

	it("matches a wildcard argument without constraining it", async () => {
		const f = fixture();
		await ev(f, `(memory/remember "w" "note" :on '(call (concat _ "b")))`);

		expect(await f.step('(concat "a" "b")')).toContain("w: note");
		expect(await f.step('(concat "a" "c")')).not.toContain("w: note");
	});

	it("matches a head by regular expression, so a whole server hooks at once", async () => {
		const f = fixture();
		await ev(f, `(memory/remember "s" "note" :on '(call (string-.*)))`);

		expect(await f.step('(string-upcase "a")')).toContain("s: note");
		expect(await f.step('(concat "a")')).not.toContain("s: note");
	});

	it("matches a call nested anywhere in the form", async () => {
		const f = fixture();
		await ev(f, `(memory/remember "n" "note" :on '(call (concat "x")))`);

		expect(await f.step('(setq v (list (concat "x" "y")))')).toContain(
			"n: note",
		);
	});

	it("combines patterns with all, any-of and not", async () => {
		const f = fixture();
		await ev(
			f,
			`(memory/remember "c" "note"
			   :on '(call (all (concat) (not (concat "skip")))))`,
		);

		expect(await f.step('(concat "keep")')).toContain("c: note");
		expect(await f.step('(concat "skip")')).not.toContain("c: note");
	});

	it("says a call trigger needs a form when handed the old string", async () => {
		const f = fixture();

		await expect(
			ev(f, `(memory/remember "k" "v" :on '(call "load-mcp"))`),
		).rejects.toThrow(/matches a form, not a name/);
	});

	it("says a text trigger needs a string when handed a form", async () => {
		const f = fixture();

		await expect(
			ev(f, `(memory/remember "k" "v" :on '(error (load-mcp)))`),
		).rejects.toThrow(/must be a string/);
	});

	it("rejects a trigger kind that does not exist", async () => {
		const f = fixture();

		await expect(
			ev(f, `(memory/remember "k" "v" :on '(whenever "x"))`),
		).rejects.toThrow(/unknown trigger kind/);
	});

	it("stays quiet outside a step, so the prelude does not fire anything", async () => {
		const bank = new MemoryBank(new VolatileStore());
		const f = fixture(bank);
		await ev(f, `(memory/remember "always" "here" :on '(step))`);

		const quiet = new MemoryInterp({
			extensions: [memoryExtension(bareHost, { bank })],
		});
		runSync(quiet, prelude);

		expect(await drive(bank.endStep())).toBe("");
	});
});

describe("chaining", () => {
	it("surfaces a linked memory alongside the one recalled", async () => {
		const f = fixture();
		await ev(
			f,
			'(memory/remember "ids" "ENG-12" :when "the test asks for it")',
		);
		await ev(
			f,
			`(memory/remember "tools" "list first" :links '("ids") :when "the test asks for it")`,
		);

		const out = await f.step('(memory/recall "tools")');
		expect(out).toContain("tools: list first");
		expect(out).toContain("ids: ENG-12");
	});

	it("lets a memory hook another memory being recalled", async () => {
		const f = fixture();
		await ev(
			f,
			'(memory/remember "tools" "list first" :when "the test asks for it")',
		);
		await ev(f, `(memory/remember "ids" "ENG-12" :on '(recall "tools"))`);

		expect(await f.step('(memory/recall "tools")')).toContain("ids: ENG-12");
	});

	it("wires together whatever fired in the same step", async () => {
		const f = fixture();
		await ev(f, `(memory/remember "a" "one" :on '(step))`);
		await ev(f, `(memory/remember "b" "two" :on '(step))`);

		await f.step("(+ 1 1)");

		expect((await remembered(f, "a"))?.links.get("b")).toBe(1);
		expect((await remembered(f, "b"))?.links.get("a")).toBe(1);
	});

	it("fires each memory at most once a step, however they chain", async () => {
		const f = fixture();
		await ev(f, `(memory/remember "a" "one" :on '(recall "b"))`);
		await ev(f, `(memory/remember "b" "two" :on '(recall "a"))`);

		const out = await f.step('(memory/recall "a")');

		expect(out.match(/a: one/g)).toHaveLength(1);
		expect(out.match(/b: two/g)).toHaveLength(1);
	});

	it("stops a chain at the cascade depth", async () => {
		const store = new VolatileStore();
		const bank = new MemoryBank(store);
		const depth = MAX_CASCADE_DEPTH + 3;
		for (let i = 0; i < depth; i++)
			store.put(
				written({
					key: `m${i}`,
					body: `body ${i}`,
					on:
						i === 0
							? { kind: "when", pattern: "the test asks for it" }
							: { kind: "recall", pattern: `^m${i - 1}$` },
					links: new Map(),
					score: 1,
					used: 0,
					lastUsed: Date.now(),
				}),
			);
		const f = fixture(bank);

		const fired = await drive(f.bank.beginStep("", f.interp));
		expect(fired).toBe("");
		await drive(f.bank.recall(f.interp, "m0", 1));
		const out = await drive(f.bank.endStep());

		expect(out).toContain("m0: body 0");
		expect(out).not.toContain(`m${depth - 1}:`);
	});
});

describe("strength, reinforcement and forgetting", () => {
	it("starts every memory at the same strength", async () => {
		const f = fixture();
		await ev(f, '(memory/remember "k" "v" :when "the test asks for it")');

		const memory = await remembered(f, "k");
		expect(memory).toBeDefined();
		expect(f.bank.strength(memory as Memory)).toBeCloseTo(1, 5);
	});

	it("strengthens a memory each time it is recalled", async () => {
		const f = fixture();
		await ev(f, '(memory/remember "k" "v" :when "the test asks for it")');
		const before = f.bank.strength((await remembered(f, "k")) as Memory);

		await drive(f.bank.beginStep("", f.interp));
		await drive(f.bank.recall(f.interp, "k", 1));

		expect(f.bank.strength((await remembered(f, "k")) as Memory)).toBeCloseTo(
			before + REINFORCEMENT,
			5,
		);
	});

	it("halves a memory's strength over the half-life", async () => {
		const clock = { now: 1_000_000 };
		const store = new VolatileStore();
		const f = fixture(new MemoryBank(store, clockAt(clock)));
		store.put(plain("k", clock.now));
		const memory = (await remembered(f, "k")) as Memory;

		expect(f.bank.strength(memory)).toBeCloseTo(1, 5);
		clock.now += HALF_LIFE_MS;
		expect(f.bank.strength(memory)).toBeCloseTo(0.5, 5);
		clock.now += HALF_LIFE_MS;
		expect(f.bank.strength(memory)).toBeCloseTo(0.25, 5);
	});

	it("sweeps away a memory that has faded under the floor", async () => {
		const clock = { now: 1_000_000 };
		const store = new VolatileStore();
		const bank = new MemoryBank(store, clockAt(clock));
		store.put(plain("k", clock.now));
		const f = fixture(bank);

		clock.now += HALF_LIFE_MS * Math.ceil(-Math.log2(FORGET_BELOW) + 1);
		await drive(f.bank.beginStep("", f.interp));

		expect(store.get("k")).toBeUndefined();
	});

	it("ranks what recall returns by strength, strongest first", async () => {
		const f = fixture();
		await ev(
			f,
			'(memory/remember "note-a" "alpha" :when "the test asks for it")',
		);
		await ev(
			f,
			'(memory/remember "note-b" "beta" :when "the test asks for it")',
		);

		await drive(f.bank.beginStep("", f.interp));
		await drive(f.bank.recall(f.interp, "note-b", 1));
		await drive(f.bank.endStep());

		expect(await ev(f, '(car (car (memory/recall "note")))')).toBe(
			'("key" . "note-b")',
		);
	});
});

describe("the plasticity window", () => {
	it("lets a recalled memory be revised in the same step", async () => {
		const f = fixture();
		await ev(
			f,
			'(memory/remember "k" "the old note" :when "the test asks for it")',
		);

		await drive(f.bank.beginStep("", f.interp));
		await ev(f, '(memory/recall "k")');
		await ev(f, '(memory/revise "k" "the corrected note")');
		await drive(f.bank.endStep());

		expect((await remembered(f, "k"))?.body).toBe("the corrected note");
	});

	it("keeps the window open across an image taken in the step", async () => {
		const f = fixture();
		await ev(
			f,
			'(memory/remember "k" "the old note" :when "the test asks for it")',
		);
		await drive(f.bank.beginStep("", f.interp));
		await ev(f, '(memory/recall "k")');

		const g = fixture(new MemoryBank(f.bank.store));
		restore(g.interp, snapshot(f.interp));
		await ev(g, '(memory/revise "k" "the corrected note")');
		await drive(g.bank.endStep());

		expect((await remembered(g, "k"))?.body).toBe("the corrected note");
	});

	it("refuses to revise a memory that has not been recalled", async () => {
		const f = fixture();
		await ev(f, '(memory/remember "k" "v" :when "the test asks for it")');

		await expect(ev(f, '(memory/revise "k" "w")')).rejects.toThrow(
			/recall it first/,
		);
	});

	it("closes the window when the step ends", async () => {
		const f = fixture();
		await ev(f, '(memory/remember "k" "v" :when "the test asks for it")');

		await drive(f.bank.beginStep("", f.interp));
		await ev(f, '(memory/recall "k")');
		await drive(f.bank.endStep());

		await expect(ev(f, '(memory/revise "k" "w")')).rejects.toThrow(
			/recall it first/,
		);
	});
});

describe("the recall budget", () => {
	it("withholds what will not fit and says how much was left", async () => {
		const f = fixture();
		const long = "word ".repeat(MAX_RECALL_WORDS * 2).trim();
		await ev(f, `(memory/remember "a" "${long}" :on '(step))`);
		await ev(f, `(memory/remember "b" "${long}" :on '(step))`);

		const out = await f.step("(+ 1 1)");

		expect(out).toContain("of recalled memory not shown");
	});
});

describe("the file store", () => {
	it("writes a remembered memory as one memory form in a .ptc file", async () => {
		const dir = mkdtempSync(join(tmpdir(), "lisptc-memory-test-"));
		const f = fixture(new MemoryBank(new FileMemoryStore(dir)));
		await ev(
			f,
			'(memory/remember "triage" "keep the ids" :when "the test asks for it")',
		);

		expect(readdirSync(dir)).toEqual(["triage.ptc"]);
		const text = readFileSync(join(dir, "triage.ptc"), "utf8");
		expect(text.startsWith('(memory "triage"')).toBe(true);
		expect(text).toContain('"keep the ids"');
	});

	it("carries prose, a trigger, links and strength back through the store", async () => {
		const dir = mkdtempSync(join(tmpdir(), "lisptc-memory-test-"));
		const first = fixture(new MemoryBank(new FileMemoryStore(dir)));
		const memory: Memory = {
			key: "triage",
			body: "keep the ids",
			on: { kind: "error", pattern: "undefined" },
			links: new Map([["other", LINKED_FIRES_AT]]),
			score: 1.5,
			used: 3,
			lastUsed: 1_700_000_000_000,
		};
		await drive(first.bank.remember(memory));

		const second = fixture(new MemoryBank(new FileMemoryStore(dir)));

		expect(await remembered(second, "triage")).toEqual(memory);
	});

	it("declares a memory read from a file in the image's memories", async () => {
		const dir = mkdtempSync(join(tmpdir(), "lisptc-memory-test-"));
		await ev(
			fixture(new MemoryBank(new FileMemoryStore(dir))),
			'(memory/remember "k" "v" :when "the test asks for it")',
		);

		const second = fixture(new MemoryBank(new FileMemoryStore(dir)));
		await ev(second, "(memories)");

		expect(await ev(second, DECLARED_KEYS)).toContain('"k"');
	});

	it("declares a memory read from a record in the image's memories", async () => {
		const store = new VolatileStore();
		store.put(plain("k"));
		const f = fixture(new MemoryBank(store));
		await ev(f, "(memories)");

		expect(await ev(f, DECLARED_KEYS)).toContain('"k"');
	});

	it("declares a memory once however often the store is read", async () => {
		const store = new VolatileStore();
		store.put(plain("k"));
		const f = fixture(new MemoryBank(store));
		await ev(f, "(memories)");
		await ev(f, '(memory/remember "other" "w" :when "the test asks for it")');
		await ev(f, "(memories)");

		expect(
			await ev(f, `(count-if (lambda (key) (equal key "k")) ${DECLARED_KEYS})`),
		).toBe("1");
	});

	it("carries a situation and the look-alike it must not fire on", async () => {
		const dir = mkdtempSync(join(tmpdir(), "lisptc-memory-test-"));
		const f = fixture(new MemoryBank(new FileMemoryStore(dir)));
		await ev(
			f,
			`(memory/remember "web" "drive it" :when "the agent is about to drive a web page" :unless "the agent only reads a page's text")`,
		);

		const g = fixture(new MemoryBank(new FileMemoryStore(dir)));

		expect((await remembered(g, "web"))?.on).toEqual({
			kind: "when",
			pattern: "the agent is about to drive a web page",
			unless: "the agent only reads a page's text",
		});
	});

	it("round-trips a call trigger, so its pattern still fires after a restart", async () => {
		const dir = mkdtempSync(join(tmpdir(), "lisptc-memory-test-"));
		const first = fixture(new MemoryBank(new FileMemoryStore(dir)));
		await ev(
			first,
			`(memory/remember "pw" "note" :on '(call (concat "playwright")))`,
		);

		const second = fixture(new MemoryBank(new FileMemoryStore(dir)));

		expect(await second.step('(concat "linear")')).not.toContain("pw: note");
		expect(await second.step('(concat "playwright")')).toContain("pw: note");
	});

	it("drops a stored memory left without a hook or a body", async () => {
		const store = new VolatileStore();
		const stored = (key: string, body: string, on: string | undefined) =>
			store.put({
				record: { key, body, on, links: [], score: 1, used: 0, lastUsed: 0 },
				source: "",
			});
		stored("unparsed", '"from an older grammar"', '(call "load-mcp")');
		stored("unhooked", '"never comes back"', undefined);
		stored("empty", '"  "', '(user "x")');
		stored("kept", '"still here"', '(user "x")');
		const f = fixture(new MemoryBank(store));

		expect(await remembered(f, "unparsed")).toBeUndefined();
		expect(await remembered(f, "unhooked")).toBeUndefined();
		expect(await remembered(f, "empty")).toBeUndefined();
		expect((await remembered(f, "kept"))?.body).toBe("still here");
	});

	it("round-trips a form body, which is what makes a recipe survive", async () => {
		const dir = mkdtempSync(join(tmpdir(), "lisptc-memory-test-"));
		const first = fixture(new MemoryBank(new FileMemoryStore(dir)));
		await ev(
			first,
			`(memory/remember "double" '(defun double (x) (* x 2)) :when "the test asks for it")`,
		);

		const second = fixture(new MemoryBank(new FileMemoryStore(dir)));
		const back = await remembered(second, "double");

		expect(typeof back?.body).not.toBe("string");
		expect(str(back?.body)).toBe("(defun double (x) (* x 2))");
	});

	it("skips a file that does not hold a memory and loads the rest", async () => {
		const dir = mkdtempSync(join(tmpdir(), "lisptc-memory-test-"));
		writeFileSync(join(dir, "broken.ptc"), '(memory "broken" ');
		writeFileSync(join(dir, "other.ptc"), '(defun other () "not a memory")');
		writeFileSync(join(dir, "old.json"), '{"key":"old"}');
		new FileMemoryStore(dir).put(plain("fine"));
		const f = fixture(new MemoryBank(new FileMemoryStore(dir)));

		expect(
			await ev(
				f,
				'(mapcar (lambda (entry) (cdr (assoc "key" entry))) (memory/list))',
			),
		).toBe('("fine")');
		await expect(ev(f, "(other)")).rejects.toThrow();
	});

	it("outlives the interpreter that wrote it", async () => {
		const dir = mkdtempSync(join(tmpdir(), "lisptc-memory-test-"));
		const first = fixture(new MemoryBank(new FileMemoryStore(dir)));
		await ev(
			first,
			'(memory/remember "k" "survives" :when "the test asks for it")',
		);

		const second = fixture(new MemoryBank(new FileMemoryStore(dir)));

		expect(
			await ev(second, '(cdr (assoc "body" (car (memory/recall "k"))))'),
		).toBe('"survives"');
	});

	it("lists nothing rather than throwing when it has never been written", () => {
		expect(
			new FileMemoryStore(join(tmpdir(), "lisptc-nothing-here")).all(),
		).toEqual([]);
	});

	it("names a memory after its key and a scope after itself", async () => {
		const base = mkdtempSync(join(tmpdir(), "lisptc-memory-test-"));
		const scoped = join(base, "thread-a");
		const key = "a key/with punctuation";
		new FileMemoryStore(scoped).put(plain(key));

		expect(readdirSync(base)).toEqual(["thread-a"]);
		expect(readdirSync(scoped)).toEqual([`${encodeURIComponent(key)}.ptc`]);
		expect(
			(
				await remembered(
					fixture(new MemoryBank(new FileMemoryStore(scoped))),
					key,
				)
			)?.key,
		).toBe(key);
	});

	it("ignores a scope directory when listing the base it sits in", () => {
		const base = mkdtempSync(join(tmpdir(), "lisptc-memory-test-"));
		new FileMemoryStore(memoryDirFor("scoped")).put(plain("theirs"));
		new FileMemoryStore(base).put(plain("mine"));

		expect(new FileMemoryStore(base).all().map((m) => m.key)).toEqual(["mine"]);
	});

	it("shows a scope what was remembered in the shared base", async () => {
		const shared = fixture(new MemoryBank(new FileMemoryStore(memoryDirFor())));
		await ev(
			shared,
			'(memory/remember "common" "everyone should know this" :when "the test asks for it")',
		);

		const scoped = fixture(new MemoryBank(scopedMemoryStore("someone")));

		expect(await ev(scoped, '(length (memory/recall "common"))')).toBe("1");
	});

	it("writes a scope's own memories into its own layer", async () => {
		const scoped = fixture(new MemoryBank(scopedMemoryStore("writer")));
		await ev(
			scoped,
			'(memory/remember "private" "only mine" :when "the test asks for it")',
		);

		const shared = fixture(new MemoryBank(new FileMemoryStore(memoryDirFor())));

		expect(await ev(shared, '(length (memory/recall "private"))')).toBe("0");
	});

	it("keeps one scope's memories out of another's", async () => {
		const mine = fixture(
			new MemoryBank(new FileMemoryStore(memoryDirFor("a"))),
		);
		const yours = fixture(
			new MemoryBank(new FileMemoryStore(memoryDirFor("b"))),
		);
		await ev(mine, '(memory/remember "k" "mine" :when "the test asks for it")');

		expect(await ev(yours, '(length (memory/recall "k"))')).toBe("0");
	});
});

describe("the listing", () => {
	it("names each memory with its strength and its trigger", async () => {
		const clock = { now: 1_000_000 };
		const f = fixture(new MemoryBank(new VolatileStore(), clockAt(clock)));
		await ev(f, `(memory/remember "k" "v" :on '(call (load-mcp)))`);

		expect(await ev(f, "(memories)")).toContain('("k" 1.0 (call (load-mcp)))');
	});

	it("strengthens nothing by being read", async () => {
		const f = fixture();
		await ev(f, '(memory/remember "k" "v" :when "the test asks for it")');
		await ev(f, "(memories)");

		expect((await remembered(f, "k"))?.used).toBe(0);
	});
});

describe("the start of a conversation", () => {
	it("says nothing when nothing fires on start", async () => {
		const f = fixture();
		await ev(
			f,
			'(memory/remember "note" "unrelated" :when "the test asks for it")',
		);
		said(f, "hello");

		expect(await opening(f)).toBe("");
	});

	it("is told on the user's first message", async () => {
		const f = fixture();
		await ev(f, `(memory/remember "role" "you are a pirate" :on '(start))`);
		said(f, "hello");

		expect(await opening(f)).toContain("you are a pirate");
	});

	it("does not fire again on a later step of the first turn", async () => {
		const f = fixture();
		await ev(f, `(memory/remember "role" "you are a pirate" :on '(start))`);
		said(f, "hello");
		await opening(f);

		expect(await opening(f)).toBe("");
	});

	it("does not fire again on a later message", async () => {
		const f = fixture();
		await ev(f, `(memory/remember "role" "you are a pirate" :on '(start))`);
		said(f, "hello");
		await opening(f);
		said(f, "and again");

		expect(await opening(f)).not.toContain("you are a pirate");
	});

	it("does not fire for a conversation already under way", async () => {
		const f = fixture();
		await ev(f, `(memory/remember "role" "you are a pirate" :on '(start))`);
		said(f, "hello");
		said(f, "and again");

		expect(await opening(f)).not.toContain("you are a pirate");
	});

	it("surfaces a form as a recipe and does not run it", async () => {
		const f = fixture();
		await ev(f, `(memory/remember "boot" '(defun greet () "hi") :on '(start))`);
		said(f, "hello");

		expect(await opening(f)).toContain("(defun greet");
		await expect(ev(f, "(greet)")).rejects.toThrow();
	});

	it("takes no pattern", async () => {
		const f = fixture();

		await expect(
			ev(f, `(memory/remember "role" "x" :on '(start "hello"))`),
		).rejects.toThrow("takes no pattern");
	});
});
