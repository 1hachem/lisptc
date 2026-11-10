import { bufferTransport } from "@repo/interpreter/channels-host";
import { driveAsync, type Eval } from "@repo/interpreter/drive";
import { journal } from "@repo/interpreter/journal";
import { type Installable, runAsync, runSync } from "@repo/interpreter/lisp";
import {
	arrayToList,
	Cell,
	jsonToLisp,
	listToArray,
	newSym,
} from "@repo/interpreter/objects";
import { prelude } from "@repo/interpreter/prelude";
import { str } from "@repo/interpreter/print";
import { openSession } from "@repo/interpreter/session";
import { memoryKind, recognizedKind } from "@repo/journal-catalog/memory";
import type { Clock } from "@repo/shared/host";
import { type Entry, view } from "@repo/shared/journal";
import type {
	Area,
	Cue,
	Recognize,
	Situation,
	Turn,
} from "@repo/shared/recognition";
import { describe, expect, it } from "vitest";
import {
	HALF_LIFE_MS,
	MAX_BUILTIN_STEP_WORDS,
	MAX_BUILTIN_WORDS,
	MAX_RECALL_WORDS,
	MemoryBank,
	memoryExtension,
	RECALLED_RESTS_STEPS,
} from "../src/memory.ts";
import { memoryHost } from "../src/memory-host.ts";
import {
	recognizeNothing,
	VolatileStore,
	WHEN_FIRES_AT,
} from "../src/ports.ts";
import { bareHost, MemoryInterp, written } from "./helpers.ts";

function drive<T>(gen: Eval<T>): Promise<T> {
	return driveAsync(gen).then((outcome) => outcome.value);
}

function carrying(memories: string): Installable {
	return Object.assign(() => {}, { memories });
}

const BROWSER = `
(memory "internal/browser/local" :when "user wants to automate a web browser" :links ("internal/browser/flags")
  "load it with (load-mcp \\"playwright\\" :local t)")

(memory "internal/browser/flags"
  "pass :quiet t only when the row lists it")

(memory "internal/deploy/notes" :on (user "^deploy")
  "deploys go through task deploy")
`;

interface Recognized {
	calls: (readonly string[])[];
	cues: (readonly Cue[])[];
	situations: Situation[];
	recognize: Recognize;
}

function recognizing(
	scores: Record<string, number>,
	afterStep: Record<string, number> = scores,
): Recognized {
	const calls: (readonly string[])[] = [];
	const cues: (readonly Cue[])[] = [];
	const situations: Situation[] = [];
	return {
		calls,
		cues,
		situations,
		recognize: (situation, asked) => {
			calls.push(asked.map((cue) => cue.situation));
			cues.push(asked);
			situations.push(situation);
			const scored =
				situation.conversation.at(-1)?.role === "user" ? scores : afterStep;
			return new Map(asked.map((cue) => [cue.key, scored[cue.situation] ?? 0]));
		},
	};
}

interface Fixture {
	interp: MemoryInterp;
	bank: MemoryBank;
	hear(text: string): Promise<string[]>;
	step(code: string, result: string): Promise<string[]>;
	entries(): Entry[];
}

function fixture(
	options: { recognize?: Recognize; clock?: Clock; memories?: string } = {},
): Fixture {
	const store = new VolatileStore();
	const bank = new MemoryBank(
		store,
		options.clock ?? memoryHost.clock,
		memoryHost.search,
		options.recognize,
	);
	const extension = memoryExtension({ ...bareHost, store }, { bank });
	const interp = new MemoryInterp({
		extensions: [extension, carrying(options.memories ?? BROWSER)],
	});
	runSync(interp, prelude);
	openSession([extension]);
	const buffer = bufferTransport();
	interp.channels.pipe(buffer);
	const conversation: Turn[] = [];
	const say = (...turns: Turn[]) => {
		conversation.push(...turns);
		interp.defineGlobal(newSym("conversation"), jsonToLisp(conversation));
		interp.defineGlobal(
			newSym("steps-taken"),
			BigInt(conversation.filter((turn) => turn.role === "assistant").length),
		);
	};
	return {
		interp,
		bank,
		entries() {
			return buffer.collect(journal);
		},
		async hear(text) {
			const before = interp.getGlobal(newSym("user-messages"));
			const all = before instanceof Cell ? listToArray(before) : [];
			interp.defineGlobal(newSym("user-messages"), arrayToList([...all, text]));
			say({ role: "user", content: text });
			const fired = await drive(bank.hear(interp));
			await drive(bank.endStep());
			return fired.map((m) => m.key);
		},
		async step(code, result) {
			say(
				{ role: "assistant", content: code },
				{ role: "tool", content: result },
			);
			const fired = await drive(bank.hear(interp));
			await drive(bank.endStep());
			return fired.map((m) => m.key);
		},
	};
}

async function ev(f: Fixture, code: string): Promise<string> {
	return str((await runAsync(f.interp, code)).value);
}

describe("built-in memories", () => {
	it("ships the memory package's own built-ins, parsed and listed", () => {
		const interp = new MemoryInterp({
			extensions: [memoryExtension(memoryHost)],
		});
		const bank = new MemoryBank(
			new VolatileStore(),
			memoryHost.clock,
			memoryHost.search,
			recognizeNothing,
		);
		bank.declareIn(interp);
		expect([...bank.builtins().keys()]).toEqual(
			expect.arrayContaining([
				"internal/memory/triggers",
				"internal/memory/call-triggers",
			]),
		);
	});

	it("fire on their own trigger, out of any store", async () => {
		const f = fixture();
		expect(await f.hear("deploy the app")).toEqual(["internal/deploy/notes"]);
		expect(f.bank.store.all()).toEqual([]);
	});

	it("are listed and recalled beside the agent's own", async () => {
		const f = fixture();
		await ev(f, '(memory/remember "mine" "a note of my own")');
		const listed = await ev(f, "(memories)");
		expect(listed).toContain('"internal/browser/flags"');
		expect(listed).toContain('"mine"');
		expect(await ev(f, `(memory/recall "quiet")`)).toContain(
			"internal/browser/flags",
		);
	});

	it("are listed on their own, with the situation or trigger that fires each", async () => {
		const f = fixture();
		await ev(f, '(memory/remember "mine" "a note of my own")');
		const listed = await ev(f, "(memory/builtins)");
		expect(listed).toContain(
			'("internal/browser/local" "user wants to automate a web browser")',
		);
		expect(listed).toContain('("internal/browser/flags" nil)');
		expect(listed).toContain('("internal/deploy/notes" (user "^deploy"))');
		expect(listed).not.toContain('"mine"');
	});

	it("are listed by area", async () => {
		const f = fixture();
		expect(
			await ev(f, '(mapcar (lambda (r) (car r)) (memory/builtins "browser"))'),
		).toBe('("internal/browser/local" "internal/browser/flags")');
		expect(await ev(f, '(memory/builtins "nowhere")')).toBe("nil");
		expect(await ev(f, "(memory/areas)")).toBe('(("browser" 2) ("deploy" 1))');
	});

	it("are read-only", async () => {
		const f = fixture();
		for (const code of [
			'(memory/remember "internal/deploy/notes" "mine now")',
			'(memory/forget "internal/deploy/notes")',
			'(memory/revise "internal/deploy/notes" "mine now")',
		])
			await expect(ev(f, code)).rejects.toThrow(/built-in memories/);
		await ev(f, "(memory/forget-all)");
		expect(f.bank.builtins().has("internal/deploy/notes")).toBe(true);
	});

	it("never fade", async () => {
		const ms = { now: 0 };
		const f = fixture({ clock: { now: () => ms.now } });
		ms.now = 52 * HALF_LIFE_MS;
		await f.hear("deploy it");
		const notes = f.bank.builtins().get("internal/deploy/notes");
		expect(notes && f.bank.strength(notes)).toBe(1);
	});

	it("load at most their step budget in one step, and the rest on a later one", async () => {
		const body = Array.from({ length: MAX_BUILTIN_WORDS - 1 }, () => "w").join(
			" ",
		);
		const fit = Math.floor(MAX_BUILTIN_STEP_WORDS / MAX_BUILTIN_WORDS);
		const keys = Array.from(
			{ length: fit + 2 },
			(_, at) => `internal/t/m${at}`,
		);
		const f = fixture({
			memories: keys
				.map((key) => `(memory "${key}" :on (user "go") "${body}")`)
				.join("\n"),
		});
		const first = await f.hear("go");
		expect(first).toHaveLength(fit);
		const second = await f.hear("go on");
		expect([...first, ...second].sort()).toEqual([...keys].sort());
	});

	it("surface past the recall budget, which is for the agent's own", async () => {
		const long = Array.from({ length: MAX_RECALL_WORDS + 20 }, () => "w").join(
			" ",
		);
		const f = fixture({
			memories: `(memory "internal/t/long" :on (user "go") "${long}")`,
		});
		await ev(f, `(memory/remember "mine" "short" :on '(user "go"))`);
		expect((await f.hear("go")).sort()).toEqual(["internal/t/long", "mine"]);
	});

	it("refuse a body past the built-in budget", () => {
		const long = Array.from({ length: MAX_BUILTIN_WORDS + 1 }, () => "w").join(
			" ",
		);
		const f = fixture({ memories: `(memory "internal/t/long" "${long}")` });
		expect(() => f.bank.builtins()).toThrow(/at most/);
	});

	it("refuse two built-ins under one key", () => {
		const f = fixture({
			memories: '(memory "internal/t/a" "one")\n(memory "internal/t/a" "two")',
		});
		expect(() => f.bank.builtins()).toThrow(/share this key/);
	});

	it("keep a body over several lines, as written", () => {
		const f = fixture({
			memories:
				'(memory "internal/t/a"\n  "first line\n  (load-mcp \\"x\\")")\n',
		});
		expect(f.bank.builtins().get("internal/t/a")?.body).toBe(
			'first line\n  (load-mcp "x")',
		);
	});

	it("refuse a key outside the internal namespace", () => {
		const f = fixture({ memories: '(memory "mcp/local" "one")' });
		expect(() => f.bank.builtins()).toThrow(/internal namespace/);
	});

	it("keep the internal namespace from the agent's own memories", async () => {
		const f = fixture();
		await expect(
			ev(f, '(memory/remember "internal/mine/note" "a note of my own")'),
		).rejects.toThrow(/built-in memories/);
	});

	it("refuse a body that is not a string", () => {
		const f = fixture({ memories: '(memory "internal/t/a" one)' });
		expect(() => f.bank.builtins()).toThrow(/needs a body string/);
	});

	it("refuse a memory with no body", () => {
		const f = fixture({
			memories: '(memory "internal/t/a")\n\n(memory "internal/t/b" "two")',
		});
		expect(() => f.bank.builtins()).toThrow(/needs a body/);
	});

	it("refuse a :when with no situation", () => {
		const f = fixture({ memories: '(memory "internal/t/a" :when "" "one")' });
		expect(() => f.bank.builtins()).toThrow(/describing the situation/);
	});

	it("refuse a situation written as an :on trigger", () => {
		const f = fixture({
			memories: '(memory "internal/t/a" :on (when "x") "one")',
		});
		expect(() => f.bank.builtins()).toThrow(/written with :when/);
	});

	it("refuse a memory with both :when and :on", () => {
		const f = fixture({
			memories: '(memory "internal/t/a" :when "x" :on (user "y") "one")',
		});
		expect(() => f.bank.builtins()).toThrow(/not both/);
	});
});

describe("the when trigger", () => {
	const ASK = "user wants to automate a web browser";

	it("fires at the threshold, with what it links", async () => {
		const { recognize } = recognizing({ [ASK]: WHEN_FIRES_AT });
		const f = fixture({ recognize });
		expect(await f.hear("open my browser and fill the form")).toEqual([
			"internal/browser/local",
			"internal/browser/flags",
		]);
	});

	it("stays quiet below the threshold", async () => {
		const { recognize } = recognizing({ [ASK]: WHEN_FIRES_AT - 0.01 });
		const f = fixture({ recognize });
		expect(await f.hear("what's the weather")).toEqual([]);
	});

	it("records what it recognized and the scores, keyed by memory", async () => {
		const { recognize } = recognizing({ [ASK]: 0.42 });
		const f = fixture({ recognize });
		await f.hear("open my browser");
		expect(view(f.entries(), recognizedKind)).toEqual([
			{
				message: "open my browser",
				scores: { "internal/browser/local": 0.42 },
			},
		]);
	});

	it("hands each memory to the recognizer with its key, area, situation and gist", async () => {
		const { recognize, cues } = recognizing({});
		const f = fixture({ recognize });
		await f.hear("open my browser");
		expect(cues[0]).toEqual([
			{
				key: "internal/browser/local",
				area: "browser",
				situation: ASK,
				gist: 'load it with (load-mcp "playwright" :local t)',
			},
		]);
	});

	it("hands over the look-alike a memory must not fire on", async () => {
		const { recognize, cues } = recognizing({});
		const f = fixture({ recognize });
		await ev(
			f,
			`(memory/remember "mine" "x" :when "${ASK}" :unless "user only names a browser")`,
		);
		await f.hear("open my browser");
		expect(cues[0]).toContainEqual(
			expect.objectContaining({
				key: "mine",
				unless: "user only names a browser",
			}),
		);
	});

	it("refuses an :unless with no :when to narrow", async () => {
		const f = fixture();
		await expect(
			ev(f, `(memory/remember "mine" "x" :unless "user only names a browser")`),
		).rejects.toThrow();
	});

	it("records the memories the recognition fired inside the recognition, linked ones too", async () => {
		const { recognize } = recognizing({ [ASK]: 0.9 });
		const f = fixture({ recognize });
		await f.hear("open my browser and fill the form");
		const [recognized] = view(f.entries(), recognizedKind);
		expect(recognized?.scores).toEqual({ "internal/browser/local": 0.9 });
		expect(recognized?.fired?.map((m) => m.key)).toEqual([
			"internal/browser/local",
			"internal/browser/flags",
		]);
		expect(recognized?.fired?.[0]?.body).toContain("load-mcp");
	});

	it("records no recognition when nothing recognizes", async () => {
		const f = fixture();
		await f.hear("open my browser");
		expect(view(f.entries(), recognizedKind)).toEqual([]);
	});

	it("records a recognition's memories once, in its own entry and nowhere else", async () => {
		const { recognize } = recognizing({ [ASK]: 0.9 });
		const f = fixture({ recognize });
		await f.hear("open my browser and fill the form");
		expect(f.entries().map((e) => e.kind)).toEqual(["recognized"]);
		expect(view(f.entries(), memoryKind)).toEqual([]);
	});

	it("records a memory another trigger fires as an entry of its own", async () => {
		const f = fixture();
		await f.hear("deploy the app");
		expect(view(f.entries(), memoryKind).map((m) => m.key)).toEqual([
			"internal/deploy/notes",
		]);
	});

	it("asks about every memory once per pass, in a single call", async () => {
		const { recognize, calls, cues } = recognizing({});
		const f = fixture({ recognize });
		await ev(f, `(memory/remember "mine" "x" :when "${ASK}")`);
		await ev(
			f,
			`(memory/remember "other" "y" :when "user asks about billing")`,
		);
		await f.hear("hello");
		expect(calls).toHaveLength(1);
		expect(new Set(cues[0]?.map((cue) => cue.key))).toEqual(
			new Set(["mine", "other", "internal/browser/local"]),
		);
	});

	it("lists built-in and remembered memories alike, narrowed by hook", async () => {
		const f = fixture();
		await ev(f, `(memory/remember "mine" "x" :when "${ASK}")`);
		await ev(f, `(memory/remember "exact" "y" :on '(user "^deploy"))`);
		expect(
			await ev(
				f,
				`(mapcar (lambda (entry) (cdr (assoc "key" entry))) (memory/list :when))`,
			),
		).toBe('("internal/browser/local" "mine")');
		expect(
			await ev(
				f,
				`(mapcar (lambda (entry) (cdr (assoc "key" entry))) (memory/list :user))`,
			),
		).toBe('("internal/deploy/notes" "exact")');
		expect(await ev(f, "(length (memory/list))")).toBe("5");
	});

	it("answers listings from the session's copy until the session writes a memory", async () => {
		const f = fixture();
		const keys = `(mapcar (lambda (entry) (cdr (assoc "key" entry))) (memory/list :when))`;
		expect(await ev(f, keys)).toBe('("internal/browser/local")');
		await f.bank.store.put(
			written({
				key: "elsewhere",
				body: "x",
				on: { kind: "when", pattern: "user asks about billing" },
				links: new Map(),
				score: 1,
				used: 0,
				lastUsed: 0,
			}),
		);
		expect(await ev(f, keys)).toBe('("internal/browser/local")');
		await ev(f, `(memory/remember "mine" "y" :when "${ASK}")`);
		expect(await ev(f, keys)).toBe(
			'("internal/browser/local" "elsewhere" "mine")',
		);
	});

	it("ships its memories with the rest length filled in", () => {
		const { memories } = memoryExtension(memoryHost);
		expect(memories).not.toMatch(/\{\{[^}]*\}\}/);
		expect(memories).toContain(`rests ${RECALLED_RESTS_STEPS} steps`);
	});

	it("lists the gate each area declares", async () => {
		const f = fixture({
			memories: `(area "browser" :when "the work drives a web browser")\n${BROWSER}`,
		});
		expect(await ev(f, "(memory/areas :when)")).toBe(
			'(("browser" "the work drives a web browser"))',
		);
		expect(await ev(f, "(memory/areas)")).toBe('(("browser" 2) ("deploy" 1))');
	});

	it("tells recognition which areas the last step already called into", async () => {
		const seen: (readonly Area[] | undefined)[] = [];
		const f = fixture({
			memories: `(area "browser" :when "the work drives a web browser")\n${BROWSER}`,
			recognize: (_, __, areas) => {
				seen.push(areas);
				return new Map();
			},
		});
		await f.hear("get me the price");
		await f.step('(browser/open "https://shop")', "opened");
		expect(seen.map((areas) => areas?.map((a) => [a.name, a.open]))).toEqual([
			[["browser", false]],
			[["browser", true]],
		]);
	});

	it("fires the agent's own memories too", async () => {
		const { recognize } = recognizing({ "user asks about billing": 0.9 });
		const f = fixture({ recognize });
		await ev(
			f,
			`(memory/remember "billing" "invoices live in stripe" :when "user asks about billing")`,
		);
		expect(await f.hear("where is my invoice")).toEqual(["billing"]);
	});

	it("fails open when the memory system fails, so the other triggers still fire", async () => {
		const f = fixture({
			recognize: () => Promise.reject(new Error("timed out")),
		});
		expect(await f.hear("deploy now")).toEqual(["internal/deploy/notes"]);
		expect(view(f.entries(), recognizedKind)).toEqual([
			{ message: "deploy now", scores: {}, error: "timed out" },
		]);
	});

	it("recognizes again before a later step, over the whole conversation", async () => {
		const { recognize, situations } = recognizing({});
		const f = fixture({ recognize });
		await f.hear("fetch the page");
		await f.step('(fetch "https://x")', "error: timed out");
		expect(situations).toEqual([
			{ conversation: [{ role: "user", content: "fetch the page" }] },
			{
				conversation: [
					{ role: "user", content: "fetch the page" },
					{ role: "assistant", content: '(fetch "https://x")' },
					{ role: "tool", content: "error: timed out" },
				],
			},
		]);
		expect(view(f.entries(), recognizedKind).map((j) => j.step)).toEqual([
			undefined,
			'(fetch "https://x")\n\nerror: timed out',
		]);
	});

	it("fires on a later step what the message alone did not call for", async () => {
		const { recognize } = recognizing({}, { [ASK]: 0.9 });
		const f = fixture({ recognize });
		expect(await f.hear("get me the price")).toEqual([]);
		expect(await f.step('(fetch "https://shop")', "needs javascript")).toEqual([
			"internal/browser/local",
			"internal/browser/flags",
		]);
	});

	it("leaves a fired memory out of recognition until its rest is over, across user messages", async () => {
		const { recognize, calls } = recognizing({
			"user asks about billing": 0.9,
		});
		const f = fixture({ recognize });
		await ev(
			f,
			`(memory/remember "billing" "invoices live in stripe" :when "user asks about billing")`,
		);
		expect(await f.hear("where is my invoice")).toEqual(["billing"]);
		expect(await f.step("(invoices)", "3 invoices")).toEqual([]);
		expect(calls.at(-1)).not.toContain("user asks about billing");
		expect(await f.hear("and the one from march")).toEqual([]);
		for (let step = 1; step < RECALLED_RESTS_STEPS - 1; step++)
			await f.step("(invoices)", "3 invoices");
		expect(await f.step("(invoices)", "3 invoices")).toEqual(["billing"]);
	});

	it("fires a built-in when memory once per user message, however many steps follow", async () => {
		const { recognize } = recognizing({ [ASK]: 0.9 });
		const f = fixture({ recognize });
		expect(await f.hear("open my browser")).toContain("internal/browser/local");
		expect(await f.step("(open)", "opened")).toEqual([]);
		expect(await f.step("(click)", "clicked")).toEqual([]);
	});

	it("keeps a spent memory quiet even when the memory system scores its description again", async () => {
		const f = fixture({ recognize: () => new Map([["mine", 0.9]]) });
		await ev(f, `(memory/remember "mine" "x" :when "${ASK}")`);
		expect(await f.hear("open my browser")).toContain("mine");
		expect(await f.step("(open)", "opened")).not.toContain("mine");
	});

	it("never fires without the memory system", async () => {
		const f = fixture();
		expect(await f.hear("open my browser and fill the form")).toEqual([]);
	});
});

describe("a loaded built-in", () => {
	const ASK = "user wants to automate a web browser";

	it("loads once, and not again while its rest lasts", async () => {
		const { recognize, calls } = recognizing({ [ASK]: 0.9 });
		const f = fixture({ recognize });
		expect(await f.hear("open my browser")).toContain("internal/browser/local");
		expect(await f.hear("now click the button")).toEqual([]);
		expect(calls).toHaveLength(1);
	});

	it("loads again once its rest is over", async () => {
		const { recognize } = recognizing({ [ASK]: 0.9 });
		const f = fixture({ recognize });
		await f.hear("open my browser");
		expect(await f.hear("open the browser again")).toEqual([]);
		for (let step = 1; step < RECALLED_RESTS_STEPS; step++)
			await f.step("(open)", "opened");
		expect(await f.step("(open)", "opened")).toContain(
			"internal/browser/local",
		);
	});
});
