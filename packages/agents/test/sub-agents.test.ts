import { restore, snapshot } from "@repo/interpreter/image";
import { Interp, runAsync, runSync } from "@repo/interpreter/lisp";
import { prelude } from "@repo/interpreter/prelude";
import { str } from "@repo/interpreter/print";
import { describe, expect, test } from "vitest";
import { agentsExtension, BOUNDED_DEFINE } from "../src/agents.ts";
import { agentsHostFor, MemorySourceFolder } from "../src/agents-host.ts";
import { readDefinition, writeDefinition } from "../src/definition.ts";
import type {
	AgentThreads,
	Message,
	Outcome,
	Seen,
	Spawn,
} from "../src/ports.ts";

class FakeThreads implements AgentThreads {
	readonly spawned: Spawn[] = [];
	readonly sent: { child: string; message: Message }[] = [];
	readonly cancelled: string[] = [];

	async spawn(spawn: Spawn): Promise<string> {
		this.spawned.push(spawn);
		return `child-${this.spawned.length}`;
	}

	async send(child: string, message: Message): Promise<string> {
		this.sent.push({ child, message });
		return `job-${this.sent.length}`;
	}

	async wait(job: string): Promise<Outcome> {
		const { message } = this.sent[Number(job.slice(4)) - 1] ?? {};
		if (message === undefined) return { failure: "lost in a restart" };
		return message.text === "fail"
			? { failure: "it broke" }
			: { reply: `got ${message.text}` };
	}

	state(job: string): Seen {
		return job.startsWith("job-") ? { state: "pending" } : { state: "lost" };
	}

	cancel(id: string): boolean {
		this.cancelled.push(id);
		return true;
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
		expect(extension.asks).toEqual([BOUNDED_DEFINE]);
		expect(calls.filter((name) => name === BOUNDED_DEFINE)).toHaveLength(1);
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
});

describe("send", () => {
	test("asks the port for a job on the spawned child", async () => {
		const { run, shown, threads } = world();
		await run('(spawn "r" :prompt "p")');
		expect(await shown('(send :to "r" "hi" :max-steps 3)')).toBe('"job-1"');
		expect(threads.sent).toEqual([
			{ child: "child-1", message: { text: "hi", maxSteps: 3 } },
		]);
	});

	test("gives a job the default step budget", async () => {
		const { run, threads } = world();
		await run('(spawn "r" :prompt "p") (send :to "r" "b")');
		expect(threads.sent[0]?.message.maxSteps).toBe(20);
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

describe("a job", () => {
	test("waited on returns its reply", async () => {
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

	test("reports where it stands as a keyword", async () => {
		const { run, shown } = world();
		await run('(spawn "r" :prompt "p")');
		expect(await shown('(agent-state (send :to "r" "hi"))')).toBe(":pending");
		expect(await shown('(agent-state "gone")')).toBe(":lost");
	});

	test("is cancelled by id, and an agent by its name", async () => {
		const { run, shown, threads } = world();
		await run('(spawn "r" :prompt "p")');
		expect(await shown('(agent-cancel (send :to "r" "hi"))')).toBe("t");
		expect(await shown('(agent-cancel "r")')).toBe("t");
		expect(threads.cancelled).toEqual(["job-1", "child-1"]);
	});
});

describe("a spawned agent's handle", () => {
	test("survives snapshot and restore, so send reopens the same child", async () => {
		const before = world();
		await before.run('(spawn "r" :prompt "p")');
		const image = snapshot(before.interp);

		const threads = new FakeThreads();
		const after = session(threads);
		restore(after.interp, image);
		await runAsync(after.interp, '(send :to "r" "again")');
		expect(threads.spawned).toEqual([]);
		expect(threads.sent[0]?.child).toBe("child-1");
	});

	test("cannot be set by Lisp code", async () => {
		const { run } = world();
		await expect(
			run('(setq *agents/spawned* \'(("r" "elsewhere")))'),
		).rejects.toThrow();
	});
});
