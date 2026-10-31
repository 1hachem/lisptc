import { driveAsync, type Eval } from "@repo/interpreter/drive";
import {
	type Installable,
	Interp,
	runAsync,
	runSync,
} from "@repo/interpreter/lisp";
import {
	arrayToList,
	Cell,
	listToArray,
	newSym,
} from "@repo/interpreter/objects";
import { prelude } from "@repo/interpreter/prelude";
import { str } from "@repo/interpreter/print";
import { openSession } from "@repo/interpreter/session";
import type { Clock } from "@repo/shared/host";
import type { ChatMessage } from "@repo/shared/messages";
import { describe, expect, it } from "vitest";
import {
	ASKS_FIRES_AT,
	HALF_LIFE_MS,
	MAX_BUILTIN_WORDS,
	MAX_RECALL_WORDS,
	MemoryBank,
	memoryExtension,
} from "../src/memory.ts";
import { memoryHost } from "../src/memory-host.ts";
import { type MemoryJudge, VolatileStore } from "../src/ports.ts";

function drive<T>(gen: Eval<T>): Promise<T> {
	return driveAsync(gen).then((outcome) => outcome.value);
}

function carrying(memories: string): Installable {
	return Object.assign(() => {}, { memories });
}

const BROWSER = `
(memory "browser/local" :on (asks "user wants to automate a web browser") :links ("browser/flags"))
load it with (load-mcp "playwright" :local t)

(memory "browser/flags")
pass :quiet t only when the row lists it

(memory "deploy/notes" :on (user "^deploy"))
deploys go through task deploy
`;

interface Judged {
	calls: (readonly string[])[];
	judge: MemoryJudge;
}

function judging(scores: Record<string, number>): Judged {
	const calls: (readonly string[])[] = [];
	return {
		calls,
		judge: (_message, asks) => {
			calls.push(asks);
			return new Map(asks.map((a) => [a, scores[a] ?? 0]));
		},
	};
}

interface Fixture {
	interp: Interp;
	bank: MemoryBank;
	hear(text: string): Promise<string[]>;
	context(messages: readonly ChatMessage[]): void;
}

function fixture(
	options: { judge?: MemoryJudge; clock?: Clock; memories?: string } = {},
): Fixture {
	const store = new VolatileStore();
	const bank = new MemoryBank(
		store,
		options.clock ?? memoryHost.clock,
		memoryHost.search,
		options.judge,
	);
	const extension = memoryExtension({ ...memoryHost, store }, { bank });
	const interp = new Interp({
		extensions: [extension, carrying(options.memories ?? BROWSER)],
	});
	runSync(interp, prelude);
	const hooks = openSession([extension]);
	return {
		interp,
		bank,
		async hear(text) {
			const before = interp.getGlobal(newSym("user-messages"));
			const all = before instanceof Cell ? listToArray(before) : [];
			interp.defineGlobal(newSym("user-messages"), arrayToList([...all, text]));
			const fired = await drive(bank.hear(interp));
			await drive(bank.endStep());
			return fired.map((m) => m.key);
		},
		context(messages) {
			hooks.context.run((_i, m) => m, interp, messages);
		},
	};
}

async function ev(f: Fixture, code: string): Promise<string> {
	return str((await runAsync(f.interp, code)).value);
}

function feedback(...keys: string[]): ChatMessage {
	return {
		role: "user",
		content: ["<memories>", ...keys.map((k) => `${k}: …`), "</memories>"].join(
			"\n",
		),
	};
}

describe("built-in memories", () => {
	it("fire on their own trigger, out of any store", async () => {
		const f = fixture();
		expect(await f.hear("deploy the app")).toEqual(["deploy/notes"]);
		expect(f.bank.store.all()).toEqual([]);
	});

	it("are listed and recalled beside the agent's own", async () => {
		const f = fixture();
		await ev(f, '(memory/remember "mine" "a note of my own")');
		const listed = await ev(f, "(memories)");
		expect(listed).toContain('"browser/flags"');
		expect(listed).toContain('"mine"');
		expect(await ev(f, `(memory/recall "quiet")`)).toContain("browser/flags");
	});

	it("are read-only", async () => {
		const f = fixture();
		for (const code of [
			'(memory/remember "deploy/notes" "mine now")',
			'(memory/forget "deploy/notes")',
			'(memory/revise "deploy/notes" "mine now")',
		])
			await expect(ev(f, code)).rejects.toThrow(/built-in memory/);
		await ev(f, "(memory/forget-all)");
		expect(f.bank.builtins().has("deploy/notes")).toBe(true);
	});

	it("never fade", async () => {
		const ms = { now: 0 };
		const f = fixture({ clock: { now: () => ms.now } });
		ms.now = 52 * HALF_LIFE_MS;
		await f.hear("deploy it");
		const notes = f.bank.builtins().get("deploy/notes");
		expect(notes && f.bank.strength(notes)).toBe(1);
	});

	it("surface past the recall budget, which is for the agent's own", async () => {
		const long = Array.from({ length: MAX_RECALL_WORDS + 20 }, () => "w").join(
			" ",
		);
		const f = fixture({
			memories: `(memory "long" :on (user "go"))\n${long}`,
		});
		await ev(f, `(memory/remember "mine" "short" :on '(user "go"))`);
		expect((await f.hear("go")).sort()).toEqual(["long", "mine"]);
	});

	it("refuse a body past the built-in budget", () => {
		const long = Array.from({ length: MAX_BUILTIN_WORDS + 1 }, () => "w").join(
			" ",
		);
		const f = fixture({ memories: `(memory "long")\n${long}` });
		expect(() => f.bank.builtins()).toThrow(/at most/);
	});

	it("refuse two built-ins under one key", () => {
		const f = fixture({
			memories: '(memory "a")\none\n(memory "a")\ntwo',
		});
		expect(() => f.bank.builtins()).toThrow(/share this key/);
	});

	it("keep a body over several lines, as written", () => {
		const f = fixture({
			memories: '(memory "a")\nfirst line\n  (load-mcp "x")\n',
		});
		expect(f.bank.builtins().get("a")?.body).toBe(
			'first line\n  (load-mcp "x")',
		);
	});

	it("refuse text that sits above every header", () => {
		const f = fixture({ memories: 'stray\n(memory "a")\none' });
		expect(() => f.bank.builtins()).toThrow(/belongs to no memory/);
	});

	it("refuse a header with no body", () => {
		const f = fixture({ memories: '(memory "a")\n\n(memory "b")\ntwo' });
		expect(() => f.bank.builtins()).toThrow(/needs a body/);
	});

	it("refuse an asks trigger with no description", () => {
		const f = fixture({ memories: '(memory "a" :on (asks))\none' });
		expect(() => f.bank.builtins()).toThrow(/says in words/);
	});
});

describe("the asks trigger", () => {
	const ASK = "user wants to automate a web browser";

	it("fires at the threshold, with what it links", async () => {
		const { judge } = judging({ [ASK]: ASKS_FIRES_AT });
		const f = fixture({ judge });
		expect(await f.hear("open my browser and fill the form")).toEqual([
			"browser/local",
			"browser/flags",
		]);
	});

	it("stays quiet below the threshold", async () => {
		const { judge } = judging({ [ASK]: ASKS_FIRES_AT - 0.01 });
		const f = fixture({ judge });
		expect(await f.hear("what's the weather")).toEqual([]);
	});

	it("asks the judge once per message, each description once", async () => {
		const { judge, calls } = judging({});
		const f = fixture({ judge });
		await ev(f, `(memory/remember "mine" "x" :on '(asks "${ASK}"))`);
		await ev(
			f,
			`(memory/remember "other" "y" :on '(asks "user asks about billing"))`,
		);
		await f.hear("hello");
		expect(calls).toEqual([[ASK, "user asks about billing"]]);
	});

	it("fires the agent's own memories too", async () => {
		const { judge } = judging({ "user asks about billing": 0.9 });
		const f = fixture({ judge });
		await ev(
			f,
			`(memory/remember "billing" "invoices live in stripe" :on '(asks "user asks about billing"))`,
		);
		expect(await f.hear("where is my invoice")).toEqual(["billing"]);
	});

	it("fails open when the judge fails, so the other triggers still fire", async () => {
		const f = fixture({
			judge: () => Promise.reject(new Error("timed out")),
		});
		expect(await f.hear("deploy now")).toEqual(["deploy/notes"]);
	});

	it("never fires without a judge", async () => {
		const f = fixture();
		expect(await f.hear("open my browser and fill the form")).toEqual([]);
	});
});

describe("a loaded built-in", () => {
	const ASK = "user wants to automate a web browser";

	it("loads once while its text is still in the conversation", async () => {
		const { judge, calls } = judging({ [ASK]: 0.9 });
		const f = fixture({ judge });
		expect(await f.hear("open my browser")).toContain("browser/local");
		f.context([feedback("browser/local", "browser/flags")]);
		expect(await f.hear("now click the button")).toEqual([]);
		expect(calls).toHaveLength(1);
	});

	it("loads again once its text has left the conversation", async () => {
		const { judge } = judging({ [ASK]: 0.9 });
		const f = fixture({ judge });
		await f.hear("open my browser");
		f.context([{ role: "user", content: "a summary of earlier work" }]);
		expect(await f.hear("open the browser again")).toContain("browser/local");
	});
});
