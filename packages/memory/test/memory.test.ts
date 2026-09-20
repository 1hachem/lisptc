import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	arrayToList,
	Cell,
	driveAsync,
	type Eval,
	Interp,
	type InterpExtension,
	listToArray,
	newSym,
	prelude,
	runAsync,
	runSync,
	str,
} from "@repo/interpreter/lisp";
import type { Clock } from "@repo/shared/host";
import { describe, expect, it } from "vitest";
import {
	FORGET_BELOW,
	HALF_LIFE_MS,
	LINKED_FIRES_AT,
	MAX_CASCADE_DEPTH,
	MAX_RECALL_WORDS,
	MemoryBank,
	memoryExtension,
	REINFORCEMENT,
	VolatileStore,
} from "../src/memory.ts";
import {
	FileMemoryStore,
	memoryDirFor,
	memoryHost,
	scopedMemoryStore,
} from "../src/memory-host.ts";

function drive<T>(gen: Eval<T>): Promise<T> {
	return driveAsync(gen).then((outcome) => outcome.value);
}

interface Fixture {
	interp: Interp;
	bank: MemoryBank;
	step(code: string): Promise<string>;
}

function fixture(
	bank: MemoryBank = new MemoryBank(new VolatileStore()),
	extras: InterpExtension[] = [],
): Fixture {
	const interp = new Interp({
		extensions: [memoryExtension(memoryHost, { bank }), ...extras],
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

async function ev(f: Fixture, code: string): Promise<string> {
	return str((await runAsync(f.interp, code)).value);
}

function said(f: Fixture, text: string): void {
	const before = f.interp.getGlobal(newSym("user-messages"));
	const all = before instanceof Cell ? listToArray(before) : [];
	f.interp.defineGlobal(newSym("user-messages"), arrayToList([...all, text]));
}

function clockAt(ms: { now: number }): Clock {
	return { now: () => ms.now };
}

describe("remembering and recalling", () => {
	it("stores prose and hands it back on a matching query", async () => {
		const f = fixture();

		expect(
			await ev(f, '(memory/remember "linear-ids" "Ids look like ENG-12.")'),
		).toBe('"linear-ids"');
		expect(
			await ev(f, '(cdr (assoc "body" (car (memory/recall "linear"))))'),
		).toBe('"Ids look like ENG-12."');
	});

	it("matches on the body as well as the key", async () => {
		const f = fixture();
		await ev(f, '(memory/remember "k" "the deploy runs on friday")');

		expect(await ev(f, '(length (memory/recall "friday"))')).toBe("1");
	});

	it("treats the query as a regular expression", async () => {
		const f = fixture();
		await ev(f, '(memory/remember "eng-12" "an issue")');

		expect(await ev(f, '(length (memory/recall "eng-[0-9]+"))')).toBe("1");
	});

	it("forgets on request", async () => {
		const f = fixture();
		await ev(f, '(memory/remember "k" "v")');

		expect(await ev(f, '(memory/forget "k")')).toBe("t");
		expect(await ev(f, '(memory/forget "k")')).toBe("nil");
		expect(await ev(f, "(length (memories))")).toBe("0");
	});

	it("keeps a form as a form, not as its value", async () => {
		const f = fixture();
		await ev(f, '(memory/remember "triage" \'(defun triage (i) (cdr i)))');

		expect(
			await ev(f, '(cdr (assoc "body" (car (memory/recall "triage"))))'),
		).toBe("(defun triage (i) (cdr i))");
	});

	it("refuses a body that cannot be read back", async () => {
		const f = fixture();

		await expect(ev(f, '(memory/remember "k" (lambda (x) x))')).rejects.toThrow(
			/reads back/,
		);
	});
});

describe("replay", () => {
	it("evaluates a remembered form, installing what it defines", async () => {
		const f = fixture();
		await ev(f, '(memory/remember "double" \'(defun double (x) (* x 2)))');

		expect(await ev(f, '(memory/replay "double")')).toBe("double");
		expect(await ev(f, "(double 21)")).toBe("42");
	});

	it("says a prose memory has nothing to run", async () => {
		const f = fixture();
		await ev(f, '(memory/remember "k" "just words")');

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
			{ key: "h", body: "note" },
		]);
		expect(await drive(f.bank.beginStep("(+ 1 1)", f.interp))).toBe("");
	});

	it("keeps a memory the user's words fired open for revision", async () => {
		const f = fixture();
		await ev(f, `(memory/remember "r" "old" :on '(user "world go"))`);

		said(f, "world go(done)");
		await f.step(`(memory/revise "r" "new")`);

		expect((await f.bank.store.get("r"))?.body).toBe("new");
	});

	it("fires once for a message however many steps a turn takes", async () => {
		const f = fixture();
		await ev(f, `(memory/remember "o" "note" :on '(user "world go"))`);

		said(f, "world go(done)");
		expect(await f.step("(+ 1 1)")).toContain("o: note");
		expect(await f.step("(+ 2 2)")).not.toContain("o: note");
	});

	it("never fires a memory that was stored without a trigger", async () => {
		const f = fixture();
		await ev(f, '(memory/remember "untriggered" "a note with no :on")');

		expect(await f.step(`(string-join '("a") ",")`)).not.toContain(
			"untriggered",
		);
		expect(await f.step("(+ 1 1)")).not.toContain("untriggered");
	});

	it("reports a missing trigger as nil, so an inert memory is visible", async () => {
		const f = fixture();
		await ev(f, '(memory/remember "untriggered" "v")');

		expect(await ev(f, "(memories)")).toContain("nil");
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

		const quiet = new Interp({
			extensions: [memoryExtension(memoryHost, { bank })],
		});
		runSync(quiet, prelude);

		expect(await drive(bank.endStep())).toBe("");
	});
});

describe("chaining", () => {
	it("surfaces a linked memory alongside the one recalled", async () => {
		const f = fixture();
		await ev(f, '(memory/remember "ids" "ENG-12")');
		await ev(f, `(memory/remember "tools" "list first" :links '("ids"))`);

		const out = await f.step('(memory/recall "tools")');
		expect(out).toContain("tools: list first");
		expect(out).toContain("ids: ENG-12");
	});

	it("lets a memory hook another memory being recalled", async () => {
		const f = fixture();
		await ev(f, '(memory/remember "tools" "list first")');
		await ev(f, `(memory/remember "ids" "ENG-12" :on '(recall "tools"))`);

		expect(await f.step('(memory/recall "tools")')).toContain("ids: ENG-12");
	});

	it("wires together whatever fired in the same step", async () => {
		const f = fixture();
		await ev(f, `(memory/remember "a" "one" :on '(step))`);
		await ev(f, `(memory/remember "b" "two" :on '(step))`);

		await f.step("(+ 1 1)");

		expect((await f.bank.store.get("a"))?.links.get("b")).toBe(1);
		expect((await f.bank.store.get("b"))?.links.get("a")).toBe(1);
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
			store.put({
				key: `m${i}`,
				body: `body ${i}`,
				on: i === 0 ? undefined : { kind: "recall", pattern: `^m${i - 1}$` },
				links: new Map(),
				score: 1,
				used: 0,
				lastUsed: Date.now(),
			});
		const f = fixture(bank);

		const fired = await drive(f.bank.beginStep("", f.interp));
		expect(fired).toBe("");
		await drive(f.bank.recall(f.interp, "^m0$", 1));
		const out = await drive(f.bank.endStep());

		expect(out).toContain("m0: body 0");
		expect(out).not.toContain(`m${depth - 1}:`);
	});
});

describe("strength, reinforcement and forgetting", () => {
	it("starts every memory at the same strength", async () => {
		const f = fixture();
		await ev(f, '(memory/remember "k" "v")');

		const memory = f.bank.store.get("k");
		expect(memory).toBeDefined();
		expect(f.bank.strength(memory as never)).toBeCloseTo(1, 5);
	});

	it("strengthens a memory each time it is recalled", async () => {
		const f = fixture();
		await ev(f, '(memory/remember "k" "v")');
		const before = f.bank.strength(f.bank.store.get("k") as never);

		await drive(f.bank.beginStep("", f.interp));
		await drive(f.bank.recall(f.interp, "k", 1));

		expect(f.bank.strength(f.bank.store.get("k") as never)).toBeCloseTo(
			before + REINFORCEMENT,
			5,
		);
	});

	it("halves a memory's strength over the half-life", () => {
		const clock = { now: 1_000_000 };
		const store = new VolatileStore();
		const bank = new MemoryBank(store, clockAt(clock));
		store.put({
			key: "k",
			body: "v",
			links: new Map(),
			score: 1,
			used: 0,
			lastUsed: clock.now,
		});

		expect(bank.strength(store.get("k") as never)).toBeCloseTo(1, 5);
		clock.now += HALF_LIFE_MS;
		expect(bank.strength(store.get("k") as never)).toBeCloseTo(0.5, 5);
		clock.now += HALF_LIFE_MS;
		expect(bank.strength(store.get("k") as never)).toBeCloseTo(0.25, 5);
	});

	it("sweeps away a memory that has faded under the floor", async () => {
		const clock = { now: 1_000_000 };
		const store = new VolatileStore();
		const bank = new MemoryBank(store, clockAt(clock));
		store.put({
			key: "k",
			body: "v",
			links: new Map(),
			score: 1,
			used: 0,
			lastUsed: clock.now,
		});
		const f = fixture(bank);

		clock.now += HALF_LIFE_MS * Math.ceil(-Math.log2(FORGET_BELOW) + 1);
		await drive(f.bank.beginStep("", f.interp));

		expect(store.get("k")).toBeUndefined();
	});

	it("ranks what recall returns by strength, strongest first", async () => {
		const f = fixture();
		await ev(f, '(memory/remember "note-a" "alpha")');
		await ev(f, '(memory/remember "note-b" "beta")');

		await drive(f.bank.beginStep("", f.interp));
		await drive(f.bank.recall(f.interp, "^note-b$", 1));
		await drive(f.bank.endStep());

		expect(await ev(f, '(car (car (memory/recall "note")))')).toBe(
			'("key" . "note-b")',
		);
	});
});

describe("the plasticity window", () => {
	it("lets a recalled memory be revised in the same step", async () => {
		const f = fixture();
		await ev(f, '(memory/remember "k" "the old note")');

		await drive(f.bank.beginStep("", f.interp));
		await ev(f, '(memory/recall "k")');
		await ev(f, '(memory/revise "k" "the corrected note")');
		await drive(f.bank.endStep());

		expect((await f.bank.store.get("k"))?.body).toBe("the corrected note");
	});

	it("refuses to revise a memory that has not been recalled", async () => {
		const f = fixture();
		await ev(f, '(memory/remember "k" "v")');

		await expect(ev(f, '(memory/revise "k" "w")')).rejects.toThrow(
			/recall it first/,
		);
	});

	it("closes the window when the step ends", async () => {
		const f = fixture();
		await ev(f, '(memory/remember "k" "v")');

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
	it("round-trips a memory through an s-expression on disk", () => {
		const dir = mkdtempSync(join(tmpdir(), "lisptc-memory-test-"));
		const store = new FileMemoryStore(dir);
		store.put({
			key: "triage",
			body: "keep the ids",
			on: { kind: "error", pattern: "undefined" },
			links: new Map([["other", LINKED_FIRES_AT]]),
			score: 1.5,
			used: 3,
			lastUsed: 1_700_000_000_000,
		});

		const back = new FileMemoryStore(dir).get("triage");

		expect(back?.key).toBe("triage");
		expect(back?.body).toBe("keep the ids");
		expect(back?.on).toEqual({ kind: "error", pattern: "undefined" });
		expect(back?.links.get("other")).toBe(LINKED_FIRES_AT);
		expect(back?.score).toBeCloseTo(1.5, 5);
		expect(back?.used).toBe(3);
		expect(back?.lastUsed).toBe(1_700_000_000_000);
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

	it("keeps a memory whose trigger no longer parses, rather than losing it", () => {
		const dir = mkdtempSync(join(tmpdir(), "lisptc-memory-test-"));
		writeFileSync(
			join(dir, "old.ptc"),
			'(memory "old" :body "from an older grammar" :on (call "load-mcp") :links nil :score 1.0 :used 0.0 :last-used 0.0)\n',
		);

		const back = new FileMemoryStore(dir).get("old");

		expect(back?.body).toBe("from an older grammar");
		expect(back?.on).toBeUndefined();
	});

	it("round-trips a form body, which is what makes a recipe survive", () => {
		const dir = mkdtempSync(join(tmpdir(), "lisptc-memory-test-"));
		const store = new FileMemoryStore(dir);
		const interp = new Interp({ extensions: [memoryExtension()] });
		runSync(interp, prelude);
		const body = runSync(interp, "(quote (defun double (x) (* x 2)))");
		store.put({
			key: "double",
			body,
			links: new Map(),
			score: 1,
			used: 0,
			lastUsed: 0,
		});

		expect(str(new FileMemoryStore(dir).get("double")?.body)).toBe(
			"(defun double (x) (* x 2))",
		);
	});

	it("outlives the interpreter that wrote it", async () => {
		const dir = mkdtempSync(join(tmpdir(), "lisptc-memory-test-"));
		const first = fixture(new MemoryBank(new FileMemoryStore(dir)));
		await ev(first, '(memory/remember "k" "survives")');

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

	it("names a memory after its key and a scope after itself", () => {
		const base = mkdtempSync(join(tmpdir(), "lisptc-memory-test-"));
		const scoped = join(base, "thread-a");
		new FileMemoryStore(scoped).put({
			key: "a key/with punctuation",
			body: "v",
			links: new Map(),
			score: 1,
			used: 0,
			lastUsed: 0,
		});

		expect(readdirSync(base)).toEqual(["thread-a"]);
		expect(readdirSync(scoped)).toEqual(["a_key_with_punctuation.ptc"]);
	});

	it("ignores a scope directory when listing the base it sits in", () => {
		const base = mkdtempSync(join(tmpdir(), "lisptc-memory-test-"));
		new FileMemoryStore(memoryDirFor("scoped")).put({
			key: "theirs",
			body: "v",
			links: new Map(),
			score: 1,
			used: 0,
			lastUsed: 0,
		});
		new FileMemoryStore(base).put({
			key: "mine",
			body: "v",
			links: new Map(),
			score: 1,
			used: 0,
			lastUsed: 0,
		});

		expect(new FileMemoryStore(base).all().map((m) => m.key)).toEqual(["mine"]);
	});

	it("shows a scope what was remembered in the shared base", async () => {
		const shared = fixture(new MemoryBank(new FileMemoryStore(memoryDirFor())));
		await ev(shared, '(memory/remember "common" "everyone should know this")');

		const scoped = fixture(new MemoryBank(scopedMemoryStore("someone")));

		expect(await ev(scoped, '(length (memory/recall "common"))')).toBe("1");
	});

	it("writes a scope's own memories into its own layer", async () => {
		const scoped = fixture(new MemoryBank(scopedMemoryStore("writer")));
		await ev(scoped, '(memory/remember "private" "only mine")');

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
		await ev(mine, '(memory/remember "k" "mine")');

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
		await ev(f, '(memory/remember "k" "v")');
		await ev(f, "(memories)");

		expect((await f.bank.store.get("k"))?.used).toBe(0);
	});
});
