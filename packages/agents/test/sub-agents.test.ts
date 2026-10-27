import { activityKey } from "@repo/interpreter/annotations";
import { bufferTransport } from "@repo/interpreter/channels-host";
import {
	extract,
	type Fragment,
	restore,
	snapshot,
} from "@repo/interpreter/image";
import { Interp, runAsync, runSync } from "@repo/interpreter/lisp";
import { newSym } from "@repo/interpreter/objects";
import { prelude } from "@repo/interpreter/prelude";
import { str } from "@repo/interpreter/print";
import {
	newSessionHooks,
	noAnnotations,
	openSession,
} from "@repo/interpreter/session";
import { output } from "@repo/interpreter/topics";
import { describe, expect, test } from "vitest";
import {
	agentsExtension,
	BOUNDED_DEFINE,
	DEFINE,
	DELEGATE_PROMPT,
	FORGET,
	KEEP,
	subAgentExtension,
} from "../src/agents.ts";
import {
	agentsHostFor,
	MemorySourceFolder,
	subAgentHost,
} from "../src/agents-host.ts";
import { readDefinition, writeDefinition } from "../src/definition.ts";
import { handlesCodec } from "../src/handles.ts";
import type {
	AgentThreads,
	Message,
	Outcome,
	Seen,
	Sent,
	Spawn,
} from "../src/ports.ts";

class FakeThreads implements AgentThreads {
	readonly spawned: Spawn[] = [];
	readonly sent: { agent: string; message: Message }[] = [];
	readonly cancelled: string[] = [];
	readonly children = new Map<string, Interp>();

	async spawn(spawn: Spawn): Promise<string> {
		this.spawned.push(spawn);
		return `child-${this.spawned.length}`;
	}

	async send(agent: string, message: Message): Promise<Sent> {
		this.sent.push({ agent, message });
		const at = this.spawned.findIndex((s) => s.definition.name === agent);
		return { job: `job-${this.sent.length}`, chat: `child-${at + 1}` };
	}

	private last(agent: string): Message | undefined {
		return this.sent.filter((s) => s.agent === agent).at(-1)?.message;
	}

	async wait(agent: string): Promise<Outcome> {
		const message = this.last(agent);
		if (message === undefined)
			return { failure: "that agent was sent nothing yet" };
		return message.text === "fail"
			? { failure: "it broke" }
			: { reply: `got ${message.text}` };
	}

	state(agent: string): Seen {
		return this.last(agent) === undefined
			? { state: "idle" }
			: { state: "pending" };
	}

	cancel(agent: string): boolean {
		this.cancelled.push(agent);
		return true;
	}

	async read(agent: string, name: string): Promise<Fragment> {
		const interp = this.children.get(agent);
		if (interp === undefined) throw new Error("the agent has run nothing yet");
		return extract(JSON.parse(JSON.stringify(snapshot(interp))), name);
	}
}

function session(threads?: FakeThreads, roster?: readonly string[]) {
	const folder = new MemorySourceFolder();
	const extension = agentsExtension(
		agentsHostFor({
			folder,
			workspace: "w",
			...(threads === undefined ? {} : { threads }),
			...(roster === undefined ? {} : { roster }),
		}),
	);
	const interp = new Interp({ extensions: [extension] });
	runSync(interp, prelude);
	return { interp, extension, folder };
}

function world(withThreads = true) {
	const threads = new FakeThreads();
	const { interp, extension, folder } = session(
		withThreads ? threads : undefined,
	);
	const calls: string[] = [];
	interp.hooks.call.use((i, name, args, next) => {
		calls.push(name);
		return next(i, name, args);
	});
	const run = (code: string) => runAsync(interp, code);
	const shown = async (code: string) => str((await run(code)).value);
	return { interp, extension, threads, folder, calls, run, shown };
}

describe("a definition file", () => {
	test("round-trips every field", () => {
		const full = {
			name: "lead",
			prompt: 'say "hi"\nthen dig',
			permissions: '(permission/deny "fs/*")',
			roster: ["scout", "digger"],
			budget: 40,
		};
		expect(readDefinition(writeDefinition(full))).toEqual(full);
		expect(readDefinition(writeDefinition({ name: "r", prompt: "p" }))).toEqual(
			{ name: "r", prompt: "p" },
		);
		expect(writeDefinition({ name: "r", prompt: "dig" })).toBe(
			'(defagent "r"\n  :prompt "dig")',
		);
		expect(readDefinition("not a form")).toBeUndefined();
		expect(readDefinition("(defagent")).toBeUndefined();
	});
});

describe("defagent", () => {
	test("writes sub-agents/<name>.ptc that spawn reuses by name", async () => {
		const { run, threads, folder } = world();
		await run(
			'(defagent "researcher" :prompt "dig" :roster \'("scout") :budget 9)',
		);
		expect(folder.list("w", "sub-agents")).toEqual(["researcher.ptc"]);
		expect(
			readDefinition(folder.read("w", "sub-agents", "researcher.ptc") ?? ""),
		).toEqual({
			name: "researcher",
			prompt: "dig",
			roster: ["scout"],
			budget: 9,
		});
		expect(str((await run('(spawn "researcher")')).value)).toBe('"researcher"');
		expect(threads.spawned[0]).toEqual({
			definition: {
				name: "researcher",
				prompt: "dig",
				roster: ["scout"],
				budget: 9,
			},
			seed: { from: "fresh" },
			chat: { from: "fresh" },
		});
	});

	test("lists what the folder holds", async () => {
		const { run, folder } = world();
		await run('(defagent "a" :prompt "x")');
		folder.write("w", "sub-agents", "b.ptc", '(defagent "b" :prompt "y")');
		folder.write("w", "sub-agents", "notes.txt", "not an agent");
		expect(str((await run("(agents)")).value)).toBe('("a" "b")');
	});

	test("shows only the roster the session was handed", async () => {
		const { interp, folder } = session(new FakeThreads(), ["shown"]);
		folder.write(
			"w",
			"sub-agents",
			"hidden.ptc",
			'(defagent "hidden" :prompt "x")',
		);
		expect(str((await runAsync(interp, "(agents)")).value)).toBe("nil");
		await expect(runAsync(interp, '(spawn "hidden")')).rejects.toThrow(
			"no saved agent by that name",
		);
	});

	test("refuses a definition without a prompt", async () => {
		const { run } = world();
		await expect(run('(defagent "a")')).rejects.toThrow(":prompt is a string");
	});

	test("refuses a budget that is not a positive integer", async () => {
		const { run } = world();
		await expect(run('(defagent "a" :prompt "p" :budget 0)')).rejects.toThrow(
			":budget is a positive integer",
		);
	});
});

describe("defagent with permissions", () => {
	test("saves the rules with the definition", async () => {
		const { run, folder } = world();
		await run(
			'(defagent "r" :prompt "p" :permissions "(permission/deny fs/*)")',
		);
		expect(
			readDefinition(folder.read("w", "sub-agents", "r.ptc") ?? ""),
		).toEqual({
			name: "r",
			prompt: "p",
			permissions: "(permission/deny fs/*)",
		});
	});

	test("goes through the form the host asks for", async () => {
		const { run, extension, calls } = world();
		await run('(defagent "r" :prompt "p" :permissions "")');
		await run('(defagent "s" :prompt "p")');
		expect(extension.asks).toEqual([DEFINE, BOUNDED_DEFINE, KEEP, FORGET]);
		expect(calls.filter((name) => name === BOUNDED_DEFINE)).toHaveLength(1);
		expect(calls.filter((name) => name === DEFINE)).toHaveLength(1);
	});

	test("refuses rules that do not read", async () => {
		const { run } = world();
		await expect(
			run('(defagent "r" :prompt "p" :permissions "(permission/deny")'),
		).rejects.toThrow(":permissions does not read");
	});
});

describe("spawn", () => {
	test("forks the image and the chat when asked", async () => {
		const { run, threads } = world();
		await run("(setq x 41)");
		await run('(spawn "s" :prompt "p" :repl :fork :chat :fork)');
		const [spawned] = threads.spawned;
		expect(spawned?.seed.from).toBe("fork");
		expect(spawned?.chat).toEqual({ from: "fork" });
		expect(JSON.stringify(spawned?.seed)).toContain('"x"');
	});

	test("with :prompt saves nothing", async () => {
		const { run, folder } = world();
		await run('(spawn "scratch" :prompt "p")');
		expect(folder.list("w", "sub-agents")).toEqual([]);
	});

	test("refuses :prompt on a name a saved agent holds", async () => {
		const { run, threads } = world();
		await run('(defagent "researcher" :prompt "dig")');
		await expect(run('(spawn "researcher" :prompt "other")')).rejects.toThrow(
			"a saved agent has that name",
		);
		expect(threads.spawned).toEqual([]);
	});

	test("refuses a name never defined", async () => {
		const { run } = world();
		await expect(run('(spawn "nobody")')).rejects.toThrow(
			"no saved agent by that name",
		);
	});

	test("is refused by a session that runs no sub-agents", async () => {
		const { run } = world(false);
		await expect(run('(spawn "r" :prompt "p")')).rejects.toThrow(
			"runs no sub-agents",
		);
	});

	test("with :prompt starts the agent on its prompt and returns its name", async () => {
		const { shown, threads } = world();
		expect(await shown('(spawn "scout" :prompt "look around")')).toBe(
			'"scout"',
		);
		expect(threads.sent).toEqual([
			{ agent: "scout", message: { text: "look around", maxSteps: 20 } },
		]);
	});

	test("of a saved definition waits for a send", async () => {
		const { run, threads } = world();
		await run('(defagent "researcher" :prompt "dig") (spawn "researcher")');
		expect(threads.spawned).toHaveLength(1);
		expect(threads.sent).toEqual([]);
	});
});

describe("send", () => {
	test("hands the port the message by the agent's name, and returns the name", async () => {
		const { run, shown, threads } = world();
		await run('(spawn "r" :prompt "p")');
		expect(await shown('(send :to "r" "hi" :max-steps 3)')).toBe('"r"');
		expect(threads.sent.at(-1)).toEqual({
			agent: "r",
			message: { text: "hi", maxSteps: 3 },
		});
	});

	test("gives a job the default step budget", async () => {
		const { run, threads } = world();
		await run('(spawn "r" :prompt "p") (send :to "r" "b")');
		expect(threads.sent.at(-1)?.message.maxSteps).toBe(20);
	});

	test("refuses an agent that was never spawned", async () => {
		const { run } = world();
		await expect(run('(send :to "nobody" "hi")')).rejects.toThrow(
			"no running agent by that name",
		);
	});

	test("refuses a step budget that is not a positive integer", async () => {
		const { run } = world();
		await run('(spawn "r" :prompt "p")');
		await expect(run('(send :to "r" "hi" :max-steps 0)')).rejects.toThrow(
			":max-steps is a positive integer",
		);
	});
});

describe("delegate", () => {
	test("spawns a fresh temporary agent, sends the brief, and returns its name at once", async () => {
		const { shown, threads } = world();
		expect(await shown('(delegate "find X" :max-steps 5)')).toBe(
			'"delegate-1"',
		);
		expect(threads.spawned).toEqual([
			{
				definition: { name: "delegate-1", prompt: DELEGATE_PROMPT },
				seed: { from: "fresh" },
				chat: { from: "fresh" },
			},
		]);
		expect(threads.sent).toEqual([
			{ agent: "delegate-1", message: { text: "find X", maxSteps: 5 } },
		]);
	});

	test("names each delegate apart, so several run at once", async () => {
		const { run, threads } = world();
		await run('(delegate "a") (delegate "b")');
		expect(threads.spawned.map((s) => s.definition.name)).toEqual([
			"delegate-1",
			"delegate-2",
		]);
		expect(threads.sent.map((s) => s.agent)).toEqual([
			"delegate-1",
			"delegate-2",
		]);
	});

	test("hands back a name agent-wait returns the reply of", async () => {
		const { shown } = world();
		expect(await shown('(agent-wait (delegate "hello"))')).toBe('"got hello"');
	});

	test("never reuses a name, even after the session restarts", async () => {
		const before = world();
		await before.run('(delegate "a")');
		const after = session(new FakeThreads());
		restore(after.interp, snapshot(before.interp));
		expect(str((await runAsync(after.interp, '(delegate "b")')).value)).toBe(
			'"delegate-2"',
		);
	});

	test("prints its name to the user and the model, even bound", async () => {
		const { interp, run } = world();
		const printed: { text: string; to: readonly string[] }[] = [];
		output.on(interp.channels, (text, e) => printed.push({ text, to: e.to }));
		await run('(setq d (delegate "a"))');
		expect(printed).toEqual([
			{ text: "delegated to delegate-1\n", to: ["user", "model"] },
		]);
	});

	test("is listed by spawned beside spawned agents, and not by agents", async () => {
		const { run } = world();
		await run('(spawn "scratch" :prompt "p") (delegate "a")');
		expect(str((await run("(spawned)")).value)).toBe(
			'("scratch" "delegate-1")',
		);
		expect(str((await run("(agents)")).value)).toBe("nil");
	});

	test("can be cancelled by its name", async () => {
		const { run, threads } = world();
		await run('(delegate "a") (agent-cancel "delegate-1")');
		expect(threads.cancelled).toEqual(["delegate-1"]);
	});

	test("cannot be kept", async () => {
		const { run } = world();
		await run('(delegate "a")');
		await expect(run('(agent-keep "delegate-1")')).rejects.toThrow(
			"a delegate cannot be kept",
		);
	});

	test("keeps its name prefix from spawn", async () => {
		const { run } = world();
		await expect(run('(spawn "delegate-1" :prompt "p")')).rejects.toThrow(
			"kept for delegate",
		);
	});

	test("refuses without a brief", async () => {
		const { run } = world();
		await expect(run("(delegate :max-steps 3)")).rejects.toThrow(
			"one brief string",
		);
	});

	test("is refused where the host runs no sub-agents", async () => {
		const { run } = world(false);
		await expect(run('(delegate "a")')).rejects.toThrow(
			"this session runs no sub-agents",
		);
	});
});

describe("a spawned agent's name", () => {
	test("is returned and printed to the user and the model", async () => {
		const { interp, run, shown } = world();
		const printed: { text: string; to: readonly string[] }[] = [];
		output.on(interp.channels, (text, e) => printed.push({ text, to: e.to }));
		expect(await shown('(spawn "scratch" :prompt "p")')).toBe('"scratch"');
		await run('(defagent "r" :prompt "x") (setq a (spawn "r"))');
		expect(printed).toEqual([
			{ text: "spawned scratch\n", to: ["user", "model"] },
			{ text: "spawned r\n", to: ["user", "model"] },
		]);
	});

	test("is unique: one spawned already is refused, finished or not", async () => {
		const { run, threads } = world();
		await run('(spawn "scratch" :prompt "p") (agent-cancel "scratch")');
		await expect(run('(spawn "scratch" :prompt "q")')).rejects.toThrow(
			"an agent of that name is spawned already",
		);
		expect(threads.spawned).toHaveLength(1);
	});

	test("is never parent, the name a sub-agent calls this session", async () => {
		const { run } = world();
		await expect(run('(spawn "parent" :prompt "p")')).rejects.toThrow(
			"parent is what a sub-agent calls this session",
		);
	});
});

describe("an agent's last message", () => {
	test("waited on by the agent's name returns its reply", async () => {
		const { run, shown } = world();
		await run('(spawn "r" :prompt "p")');
		expect(await shown('(agent-wait (send :to "r" "hello"))')).toBe(
			'"got hello"',
		);
	});

	test("that failed raises when waited on", async () => {
		const { run } = world();
		await run('(spawn "r" :prompt "p")');
		await expect(run('(agent-wait (send :to "r" "fail"))')).rejects.toThrow(
			"it broke",
		);
	});

	test("cannot be waited on before one was sent", async () => {
		const { run } = world();
		await run('(defagent "r" :prompt "x") (spawn "r")');
		await expect(run('(agent-wait "r")')).rejects.toThrow(
			"that agent was sent nothing yet",
		);
	});

	test("reports where it stands as a keyword, idle before any", async () => {
		const { run, shown } = world();
		await run('(defagent "r" :prompt "x") (spawn "r")');
		expect(await shown('(agent-state "r")')).toBe(":idle");
		expect(await shown('(agent-state (send :to "r" "hi"))')).toBe(":pending");
	});

	test("cancels the agent by its name", async () => {
		const { run, shown, threads } = world();
		await run('(spawn "r" :prompt "p")');
		expect(await shown('(agent-cancel "r")')).toBe("t");
		expect(threads.cancelled).toEqual(["r"]);
	});

	test("refuses anything but a spawned agent's name", async () => {
		const { run } = world();
		await run('(spawn "r" :prompt "p")');
		for (const form of ["agent-wait", "agent-state", "agent-cancel"])
			await expect(run(`(${form} "nobody")`)).rejects.toThrow(
				"no agent spawned by that name; (spawned) lists them",
			);
	});
});

describe("a spawned agent's handle", () => {
	test("survives snapshot and restore, so send reaches the same agent by name", async () => {
		const before = world();
		await before.run('(spawn "r" :prompt "p")');
		const image = snapshot(before.interp);

		const threads = new FakeThreads();
		const after = session(threads);
		restore(after.interp, image);
		await runAsync(after.interp, '(send :to "r" "again")');
		expect(threads.spawned).toEqual([]);
		expect(threads.sent[0]?.agent).toBe("r");
	});

	test("hold names only, never an id", async () => {
		const { interp, run } = world();
		await run('(spawn "scratch" :prompt "p") (delegate "a")');
		expect(
			handlesCodec.fromLisp(interp.getGlobal(newSym("*agents/spawned*"))),
		).toEqual([
			{
				name: "scratch",
				unsaved: writeDefinition({ name: "scratch", prompt: "p" }),
			},
			{ name: "delegate-1" },
		]);
	});

	test("cannot be set by Lisp code", async () => {
		const { run } = world();
		await expect(
			run('(setq *agents/spawned* \'(("r" "elsewhere")))'),
		).rejects.toThrow();
	});
});

describe("a saved definition", () => {
	test("reads back as its file's text, or nil", async () => {
		const { run, shown } = world();
		await run('(defagent "r" :prompt "dig")');
		expect(await shown('(agent-definition "r")')).toBe(
			str('(defagent "r"\n  :prompt "dig")'),
		);
		expect(await shown('(agent-definition "nobody")')).toBe("nil");
	});
});

describe("agent-forget", () => {
	test("deletes a saved definition through the form the host asks for", async () => {
		const { run, shown, folder, calls } = world();
		await run('(defagent "researcher" :prompt "dig")');
		expect(await shown('(agent-forget "researcher")')).toBe("t");
		expect(calls).toContain(FORGET);
		expect(folder.list("w", "sub-agents")).toEqual([]);
	});

	test("returns nil when no definition of that name is saved", async () => {
		const { shown } = world();
		expect(await shown('(agent-forget "ghost")')).toBe("nil");
	});
});

describe("agent-keep", () => {
	test("saves a temporary agent as a definition another session spawns by name", async () => {
		const { run, shown, folder, calls } = world();
		await run('(spawn "scratch" :prompt "dig" :budget 5)');
		expect(await shown('(agent-keep "scratch")')).toBe('"scratch"');
		expect(calls).toContain(KEEP);
		expect(
			readDefinition(folder.read("w", "sub-agents", "scratch.ptc") ?? ""),
		).toEqual({ name: "scratch", prompt: "dig", budget: 5 });
		expect(await shown("(agents)")).toBe('("scratch")');
	});

	test("refuses an agent saved already, and one never spawned", async () => {
		const { run } = world();
		await run('(spawn "scratch" :prompt "dig") (agent-keep "scratch")');
		await expect(run('(agent-keep "scratch")')).rejects.toThrow(
			"saved already",
		);
		await expect(run('(agent-keep "nobody")')).rejects.toThrow(
			"no agent spawned by that name",
		);
	});

	test("refuses a temporary agent once defagent saved its name", async () => {
		const { run } = world();
		await run('(spawn "scratch" :prompt "dig")');
		await run('(defagent "scratch" :prompt "better")');
		await expect(run('(agent-keep "scratch")')).rejects.toThrow(
			"saved already",
		);
	});

	test("still knows a temporary agent after snapshot and restore", async () => {
		const before = world();
		await before.run('(spawn "scratch" :prompt "dig")');
		const image = snapshot(before.interp);

		const after = session(new FakeThreads());
		restore(after.interp, image);
		await runAsync(after.interp, '(agent-keep "scratch")');
		expect(
			readDefinition(after.folder.read("w", "sub-agents", "scratch.ptc") ?? ""),
		).toEqual({ name: "scratch", prompt: "dig" });
	});
});

describe("a spawn or a send", () => {
	test("is reported as activity naming the chat the agent runs in", async () => {
		const { interp, extension, run } = world();
		const buffer = bufferTransport();
		const detach = interp.channels.pipe(buffer);
		try {
			await run('(spawn "scout" :prompt "look") (send :to "scout" "go")');
		} finally {
			detach();
		}
		const into = openSession([extension]).annotate.run(
			(_b, into) => into,
			buffer,
			noAnnotations(),
		);

		expect(
			activityKey.schema.safeParse(into.output[activityKey.name]).data,
		).toEqual([
			{
				kind: "agent",
				label: "scout",
				detail: "spawned",
				state: "done",
				id: "agent-child-1",
				chat: "child-1",
			},
			{
				kind: "agent",
				label: "scout",
				detail: "look",
				state: "done",
				id: "job-1",
				chat: "child-1",
			},
			{
				kind: "agent",
				label: "scout",
				detail: "go",
				state: "done",
				id: "job-2",
				chat: "child-1",
			},
		]);
	});
});

function subAgent() {
	const extension = subAgentExtension(subAgentHost());
	const interp = new Interp({ extensions: [extension] });
	runSync(interp, prelude);
	const hooks = newSessionHooks();
	extension.session?.(hooks);
	const answer = (code: string) => hooks.answer.run((_i, c) => c, interp, code);
	return { interp, answer };
}

describe("a sub-agent's exports", () => {
	test("leave the answer alone until something is exported", () => {
		const { interp, answer } = subAgent();
		expect(answer("all done")).toBe("all done");
		runSync(
			interp,
			'(setq prices (list 1 2)) (agents/export \'prices "list of numbers")',
		);
		runSync(
			interp,
			'(agents/export \'prices "list of integers: price per SKU")',
		);
		expect(answer("all done")).toBe(
			'all done\n\nexports, take with (agent-take "agent" \'name):\n  prices: list of integers: price per SKU',
		);
	});

	test("refuse a name that is not a bound symbol", () => {
		const { interp } = subAgent();
		expect(() => runSync(interp, '(agents/export \'nothing "x")')).toThrow(
			"bind it before exporting it",
		);
		expect(() => runSync(interp, '(agents/export "prices" "x")')).toThrow(
			"quoted symbol",
		);
	});

	test("survive an image", () => {
		const { interp } = subAgent();
		runSync(interp, '(setq n 1) (agents/export \'n "a number")');
		const back = new Interp({
			extensions: [subAgentExtension(subAgentHost())],
		});
		restore(back, snapshot(interp));
		expect(str(runSync(back, "*agents/exports*"))).toBe('(("n" "a number"))');
	});
});

describe("agent-take", () => {
	async function spawnedWith(code: string) {
		const parent = world();
		await parent.run('(spawn "scratch" :prompt "dig")');
		const child = subAgent();
		runSync(child.interp, code);
		parent.threads.children.set("scratch", child.interp);
		return parent;
	}

	test("copies an exported value into this session", async () => {
		const { shown } = await spawnedWith(
			'(setq rows (list (list :sku "a" :price 2.5))) (agents/export \'rows "rows")',
		);
		expect(await shown('(setq mine (agent-take "scratch" \'rows))')).toBe(
			'((:sku "a" :price 2.5))',
		);
		expect(await shown("(car mine)")).toBe('(:sku "a" :price 2.5)');
	});

	test("brings a function with its captured variables", async () => {
		const { shown } = await spawnedWith(
			'(setq add (let ((n 5)) (lambda (x) (+ x n)))) (agents/export \'add "adds five")',
		);
		expect(await shown('((agent-take "scratch" \'add) 1)')).toBe("6");
	});

	test("refuses what was not exported, and an agent never spawned", async () => {
		const { run } = await spawnedWith(
			'(setq rows 1 secret 2) (agents/export \'rows "rows")',
		);
		await expect(run('(agent-take "scratch" \'secret)')).rejects.toThrow(
			"scratch exports rows",
		);
		await expect(run('(agent-take "other" \'rows)')).rejects.toThrow(
			"no agent spawned by that name; (spawned) lists them",
		);
	});

	test("reads a delegate by the name delegate returned", async () => {
		const parent = world();
		await parent.run('(setq d (delegate "make one"))');
		const child = subAgent();
		runSync(child.interp, '(setq id "x7") (agents/export \'id "an id")');
		parent.threads.children.set("delegate-1", child.interp);
		expect(await parent.shown("(agent-take d 'id)")).toBe('"x7"');
	});
});

describe("the spawned handles", () => {
	test("keep their names through the codec", () => {
		const held = [{ name: "b", unsaved: '(defagent "b")' }, { name: "c" }];
		expect(handlesCodec.fromLisp(handlesCodec.toLisp(held))).toEqual(held);
	});
});
