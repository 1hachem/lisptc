import type { Outcome } from "@repo/interpreter/drive";
import { Interp, runAsync, runSync } from "@repo/interpreter/lisp";
import { prelude } from "@repo/interpreter/prelude";
import { str } from "@repo/interpreter/print";
import { LispPromise } from "@repo/interpreter/promise";
import { describe, expect, test } from "vitest";
import { agentsExtension } from "../src/agents.ts";
import { agentsHostFor, MemoryAgentDefinitions } from "../src/agents-host.ts";
import type { AgentRunner, Ask, Spawn } from "../src/ports.ts";

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
	const interp = new Interp({
		extensions: [
			agentsExtension(
				agentsHostFor(withRunner ? { definitions, runner } : { definitions }),
			),
		],
	});
	runSync(interp, prelude);
	const run = (code: string) => runAsync(interp, code);
	return { interp, recorded, definitions, run };
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

describe("spawn", () => {
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
