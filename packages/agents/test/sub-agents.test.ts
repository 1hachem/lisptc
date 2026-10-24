import { Interp, runAsync, runSync } from "@repo/interpreter/lisp";
import { prelude } from "@repo/interpreter/prelude";
import { str } from "@repo/interpreter/print";
import { describe, expect, test } from "vitest";
import { agentsExtension, BOUNDED_DEFINE } from "../src/agents.ts";
import { agentsHostFor, MemoryAgentDefinitions } from "../src/agents-host.ts";
import type { AgentJobs, Job, JobState, Outcome, Spawn } from "../src/ports.ts";

class RecordedJobs implements AgentJobs {
	readonly spawned: Spawn[] = [];
	readonly sent: { agent: string; job: Job }[] = [];
	readonly cancelled: string[] = [];

	spawn(spawn: Spawn): string {
		this.spawned.push(spawn);
		return `agent-${this.spawned.length}`;
	}

	send(agent: string, job: Job): string {
		this.sent.push({ agent, job });
		return `job-${this.sent.length}`;
	}

	state(_job: string): JobState {
		return "running";
	}

	async wait(job: string): Promise<Outcome> {
		const { message } = this.sent[Number(job.slice(4)) - 1].job;
		return message === "fail"
			? { failure: "it broke" }
			: { reply: `got ${message}` };
	}

	cancel(job: string): boolean {
		this.cancelled.push(job);
		return true;
	}
}

function world(withJobs = true) {
	const jobs = new RecordedJobs();
	const definitions = new MemoryAgentDefinitions();
	const extension = agentsExtension(
		agentsHostFor(withJobs ? { definitions, jobs } : { definitions }),
	);
	const interp = new Interp({ extensions: [extension] });
	runSync(interp, prelude);
	const calls: string[] = [];
	interp.hooks.call.use((i, name, args, next) => {
		calls.push(name);
		return next(i, name, args);
	});
	const run = (code: string) => runAsync(interp, code);
	const shown = async (code: string) => str((await run(code)).value);
	return { extension, jobs, definitions, calls, run, shown };
}

describe("defagent", () => {
	test("saves a definition spawn reuses by name", async () => {
		const { run, jobs, definitions } = world();
		await run('(defagent "researcher" :prompt "dig")');
		expect(definitions.get("researcher")).toEqual({
			name: "researcher",
			prompt: "dig",
		});
		expect(str((await run('(spawn "researcher")')).value)).toBe('"researcher"');
		expect(jobs.spawned[0]).toEqual({
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
		const { run, jobs } = world();
		await run('(spawn "a" :prompt "p") (spawn "b" :prompt "p" :chat :fork)');
		expect(jobs.spawned.map((spawn) => spawn.chat)).toEqual([
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
		const { run, jobs, definitions } = world();
		await run('(spawn "scratch" :prompt "think")');
		expect(jobs.spawned[0].definition).toEqual({
			name: "scratch",
			prompt: "think",
		});
		expect(definitions.all()).toEqual([]);
	});

	test("forks a copy of the image as it stands", async () => {
		const { run, jobs } = world();
		await run('(setq x 41) (spawn "scratch" :prompt "p" :repl :fork)');
		const { seed } = jobs.spawned[0];
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

	test("says so in a session with no jobs", async () => {
		const { run } = world(false);
		await expect(run('(spawn "s" :prompt "p")')).rejects.toThrow(
			"runs no sub-agents",
		);
	});
});

describe("send", () => {
	test("hands the message to the agent's jobs and returns the job id", async () => {
		const { run, shown, jobs } = world();
		await run('(spawn "r" :prompt "p")');
		expect(await shown('(send :to "r" "hello" :max-steps 3)')).toBe('"job-1"');
		expect(jobs.sent).toEqual([
			{ agent: "agent-1", job: { message: "hello", maxSteps: 3 } },
		]);
	});

	test("gives a job the default step budget", async () => {
		const { run, jobs } = world();
		await run('(spawn "r" :prompt "p") (send :to "r" "b")');
		expect(jobs.sent[0].job.maxSteps).toBe(20);
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
		expect(await shown('(agent-state (send :to "r" "hi"))')).toBe(":running");
	});

	test("can be cancelled", async () => {
		const { run, shown, jobs } = world();
		await run('(spawn "r" :prompt "p")');
		expect(await shown('(agent-cancel (send :to "r" "hi"))')).toBe("t");
		expect(jobs.cancelled).toEqual(["job-1"]);
	});
});
