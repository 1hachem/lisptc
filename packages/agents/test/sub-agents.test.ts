import type { Outcome } from "@repo/interpreter/drive";
import { Interp, runAsync, runSync } from "@repo/interpreter/lisp";
import { prelude } from "@repo/interpreter/prelude";
import { str } from "@repo/interpreter/print";
import { LispPromise } from "@repo/interpreter/promise";
import { newSessionHooks, type StepContext } from "@repo/interpreter/session";
import { describe, expect, test } from "vitest";
import { agentsExtension, BOUNDED_DEFINE } from "../src/agents.ts";
import { agentsHostFor, MemoryAgentDefinitions } from "../src/agents-host.ts";
import type { AgentRunner, Ask, Notice, Spawn } from "../src/ports.ts";

interface Recorded {
	readonly spawned: Spawn[];
	readonly asked: Ask[];
	release: () => void;
}

function world(withRunner = true) {
	const recorded: Recorded = { spawned: [], asked: [], release: () => {} };
	const runner: AgentRunner = {
		spawn(spawn) {
			recorded.spawned.push(spawn);
			return {
				async send(ask) {
					recorded.asked.push(ask);
					if (ask.message === "fail") throw new Error("it broke");
					if (ask.message === "hold")
						await new Promise<void>((resolve) => {
							recorded.release = resolve;
						});
					return `${spawn.definition.name} got ${ask.message}`;
				},
			};
		},
	};
	const definitions = new MemoryAgentDefinitions();
	const notices: Notice[] = [];
	const notify = (notice: Notice) => notices.push(notice);
	const extension = agentsExtension(
		agentsHostFor(
			withRunner ? { definitions, runner, notify } : { definitions, notify },
		),
	);
	const interp = new Interp({ extensions: [extension] });
	runSync(interp, prelude);
	const hooks = newSessionHooks();
	extension.session?.(hooks);
	const run = (code: string) => runAsync(interp, code);
	const step = async (code: string) => {
		let outcome: Outcome | undefined;
		await hooks.evalStep.run(async () => {
			outcome = await run(code);
			if (outcome.value instanceof LispPromise)
				await outcome.value.promise().catch(() => undefined);
		}, {} as StepContext);
		return outcome;
	};
	const calls: string[] = [];
	interp.hooks.call.use((i, name, args, next) => {
		calls.push(name);
		return next(i, name, args);
	});
	return {
		interp,
		extension,
		recorded,
		definitions,
		notices,
		calls,
		run,
		step,
	};
}

async function settled({ value }: Outcome): Promise<unknown> {
	if (!(value instanceof LispPromise)) throw new Error("not a promise");
	return value.promise();
}

describe("defagent", () => {
	test("saves a definition spawn reuses by name", async () => {
		const { run, recorded, definitions } = world();
		await run('(defagent "researcher" :prompt "dig")');
		expect(definitions.get("researcher")).toEqual({
			name: "researcher",
			prompt: "dig",
		});
		expect(str((await run('(spawn "researcher")')).value)).toBe('"researcher"');
		expect(recorded.spawned[0]).toEqual({
			definition: { name: "researcher", prompt: "dig" },
			seed: { from: "fresh" },
			chat: { from: "fresh" },
		});
	});

	test("lists what was saved", async () => {
		const { run } = world();
		await run('(defagent "a" :prompt "x")');
		await run('(defagent "b" :prompt "y")');
		expect(str((await run("(agents)")).value)).toBe('("a" "b")');
	});

	test("refuses a definition without a prompt", async () => {
		const { run } = world();
		await expect(run('(defagent "a")')).rejects.toThrow(":prompt is a string");
	});
});

describe("defagent with permissions", () => {
	test("saves the rules with the definition", async () => {
		const { run, definitions } = world();
		await run(
			'(defagent "r" :prompt "p" :permissions "(permission/deny fs/*)")',
		);
		expect(definitions.get("r")).toEqual({
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
		expect(calls).toContain(BOUNDED_DEFINE);
		expect(calls.filter((name) => name === BOUNDED_DEFINE)).toHaveLength(1);
	});

	test("refuses rules that are not text", async () => {
		const { run } = world();
		await expect(
			run('(defagent "r" :prompt "p" :permissions 3)'),
		).rejects.toThrow(":permissions is a string");
	});
});

describe("spawn", () => {
	test("starts with a fresh chat unless told to fork it", async () => {
		const { run, recorded } = world();
		await run('(spawn "a" :prompt "p") (spawn "b" :prompt "p" :chat :fork)');
		expect(recorded.spawned.map((spawn) => spawn.chat)).toEqual([
			{ from: "fresh" },
			{ from: "fork" },
		]);
	});

	test("refuses an unknown chat seed", async () => {
		const { run } = world();
		await expect(
			run('(spawn "s" :prompt "p" :chat :borrowed)'),
		).rejects.toThrow(":chat is :fresh or :fork");
	});

	test("takes an ad hoc prompt without saving it", async () => {
		const { run, recorded, definitions } = world();
		await run('(spawn "scratch" :prompt "think")');
		expect(recorded.spawned[0].definition).toEqual({
			name: "scratch",
			prompt: "think",
		});
		expect(definitions.all()).toEqual([]);
	});

	test("forks a copy of the image as it stands", async () => {
		const { run, recorded } = world();
		await run('(setq x 41) (spawn "scratch" :prompt "p" :repl :fork)');
		const { seed } = recorded.spawned[0];
		expect(seed.from).toBe("fork");
		expect(JSON.stringify(seed)).toContain('"x"');
	});

	test("refuses an unknown repl seed", async () => {
		const { run } = world();
		await expect(
			run('(spawn "s" :prompt "p" :repl :borrowed)'),
		).rejects.toThrow(":repl is :fresh or :fork");
	});

	test("refuses a name nothing defines", async () => {
		const { run } = world();
		await expect(run('(spawn "ghost")')).rejects.toThrow(
			"no saved agent by that name",
		);
	});

	test("says so in a session with no runner", async () => {
		const { run } = world(false);
		await expect(run('(spawn "s" :prompt "p")')).rejects.toThrow(
			"runs no sub-agents",
		);
	});
});

describe("send", () => {
	test("returns a promise of the reply at once", async () => {
		const { run } = world();
		await run('(spawn "r" :prompt "p")');
		const promise = await run('(send :to "r" "hello" :max-steps 3)');
		expect(await settled(promise)).toBe("r got hello");
	});

	test("hands the agent its step budget, with a default", async () => {
		const { run, recorded } = world();
		await run('(spawn "r" :prompt "p")');
		await settled(await run('(send :to "r" "a" :max-steps 3)'));
		await settled(await run('(send :to "r" "b")'));
		expect(recorded.asked.map((ask) => ask.maxSteps)).toEqual([3, 20]);
	});

	test("runs the messages to one agent in turn", async () => {
		const { run, recorded } = world();
		await run('(spawn "r" :prompt "p")');
		const first = await run('(send :to "r" "hold")');
		const second = await run('(send :to "r" "next")');
		await new Promise((resolve) => setTimeout(resolve, 5));
		expect(recorded.asked.map((ask) => ask.message)).toEqual(["hold"]);
		recorded.release();
		expect(await settled(second)).toBe("r got next");
		expect(await settled(first)).toBe("r got hold");
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

describe("a reply", () => {
	test("awaited within a step reaches nobody else", async () => {
		const { run, step, notices } = world();
		await run('(spawn "r" :prompt "p")');
		await step('(send :to "r" "hello")');
		expect(notices).toEqual([]);
	});

	test("landing outside a step is handed to the host", async () => {
		const { run, notices } = world();
		await run('(spawn "r" :prompt "p")');
		await settled(await run('(send :to "r" "hello")'));
		await Promise.resolve();
		expect(notices).toEqual([{ agent: "r", reply: "r got hello" }]);
	});

	test("that fails is handed over as a failure", async () => {
		const { run, notices } = world();
		await run('(spawn "r" :prompt "p")');
		await settled(await run('(send :to "r" "fail")')).catch(() => undefined);
		await Promise.resolve();
		expect(notices).toEqual([
			{ agent: "r", failure: expect.stringContaining("it broke") },
		]);
	});
});
