import { restore, snapshot } from "@repo/interpreter/image";
import { Interp, runAsync, runSync } from "@repo/interpreter/lisp";
import { prelude } from "@repo/interpreter/prelude";
import { str } from "@repo/interpreter/print";
import { describe, expect, test } from "vitest";
import { agentsExtension, BOUNDED_DEFINE } from "../src/agents.ts";
import { agentsHostFor, MemoryAgentDefinitions } from "../src/agents-host.ts";
import type { Jobs, Outcome, Seen, Spawn, Work } from "../src/ports.ts";

class RecordedJobs implements Jobs {
	readonly spawned: Spawn[] = [];
	readonly submitted: Work[] = [];
	readonly cancelled: string[] = [];
	readonly forgotten = new Set<string>();

	async spawn(spawn: Spawn): Promise<string> {
		this.spawned.push(spawn);
		return `agent-${this.spawned.length}`;
	}

	submit(work: Work): string {
		this.submitted.push(work);
		return `job-${this.submitted.length}`;
	}

	peek(job: string): Seen | undefined {
		return this.forgotten.has(job) ? undefined : { state: "running" };
	}

	async wait(job: string): Promise<Outcome> {
		const work = this.submitted[Number(job.slice(4)) - 1];
		if (work.kind === "code") return { reply: `ran ${work.source}` };
		return work.message === "fail"
			? { failure: "it broke" }
			: { reply: `got ${work.message}` };
	}

	cancel(job: string): boolean {
		this.cancelled.push(job);
		return true;
	}
}

function session(jobs: RecordedJobs | undefined) {
	const definitions = new MemoryAgentDefinitions();
	const extension = agentsExtension(
		agentsHostFor(jobs === undefined ? { definitions } : { definitions, jobs }),
	);
	const interp = new Interp({ extensions: [extension] });
	runSync(interp, prelude);
	return { interp, extension, definitions };
}

function world(withJobs = true) {
	const jobs = new RecordedJobs();
	const { interp, extension, definitions } = session(
		withJobs ? jobs : undefined,
	);
	const calls: string[] = [];
	interp.hooks.call.use((i, name, args, next) => {
		calls.push(name);
		return next(i, name, args);
	});
	const run = (code: string) => runAsync(interp, code);
	const shown = async (code: string) => str((await run(code)).value);
	return { interp, extension, jobs, definitions, calls, run, shown };
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
			"runs no background jobs",
		);
	});
});

describe("send", () => {
	test("hands the message to the agent's jobs and returns the job id", async () => {
		const { run, shown, jobs } = world();
		await run('(spawn "r" :prompt "p")');
		expect(await shown('(send :to "r" "hello" :max-steps 3)')).toBe('"job-1"');
		expect(jobs.submitted).toEqual([
			{
				kind: "agent",
				agent: "agent-1",
				name: "r",
				message: "hello",
				maxSteps: 3,
			},
		]);
	});

	test("gives a job the default step budget", async () => {
		const { run, jobs } = world();
		await run('(spawn "r" :prompt "p") (send :to "r" "b")');
		expect(jobs.submitted[0]).toMatchObject({ maxSteps: 20 });
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
		expect(await shown('(job-wait (send :to "r" "hello"))')).toBe(
			'"got hello"',
		);
	});

	test("that failed raises when waited on", async () => {
		const { run } = world();
		await run('(spawn "r" :prompt "p")');
		await expect(run('(job-wait (send :to "r" "fail"))')).rejects.toThrow(
			"it broke",
		);
	});

	test("reports where it stands as a keyword", async () => {
		const { run, shown } = world();
		await run('(spawn "r" :prompt "p")');
		expect(await shown('(job-state (send :to "r" "hi"))')).toBe(":running");
	});

	test("can be cancelled", async () => {
		const { run, shown, jobs } = world();
		await run('(spawn "r" :prompt "p")');
		expect(await shown('(job-cancel (send :to "r" "hi"))')).toBe("t");
		expect(jobs.cancelled).toEqual(["job-1"]);
	});
});

describe("background code", () => {
	test("runs a form on a copy of the image and hands back its job id", async () => {
		const { run, shown, jobs } = world();
		await run("(setq x 41)");
		expect(await shown("(spawn :code '(+ x 1))")).toBe('"job-1"');
		const [work] = jobs.submitted;
		expect(work).toMatchObject({ kind: "code", source: "(+ x 1)" });
		expect(JSON.stringify(work)).toContain('"x"');
	});

	test("returns what it printed when waited on", async () => {
		const { shown } = world();
		expect(await shown("(job-wait (spawn :code '(+ 1 2)))")).toBe(
			'"ran (+ 1 2)"',
		);
	});

	test("takes no name", async () => {
		const { run } = world();
		await expect(run('(spawn "r" :code \'(+ 1 2))')).rejects.toThrow(
			"spawn :code takes no name",
		);
	});
});

describe("the job table", () => {
	test("lists every job with where it stands", async () => {
		const { run, shown } = world();
		await run('(spawn "r" :prompt "p") (send :to "r" "hi")');
		expect(await shown("(jobs)")).toBe(
			'((:id "job-1" :kind :agent :label "r" :state :running))',
		);
	});

	test("keeps a finished job's outcome once waited on", async () => {
		const { run, shown } = world();
		await run('(spawn "r" :prompt "p") (job-wait (send :to "r" "hi"))');
		expect(await shown('(job-state "job-1")')).toBe(":done");
		expect(await shown("(jobs)")).toContain(':reply "got hi"');
	});

	test("refuses a job it never started", async () => {
		const { run } = world();
		await expect(run('(job-state "nope")')).rejects.toThrow(
			"no job by that id",
		);
	});

	test("survives an image, agents and jobs alike", async () => {
		const before = world();
		await before.run('(spawn "r" :prompt "p") (send :to "r" "hi")');
		const image = snapshot(before.interp);

		const jobs = new RecordedJobs();
		const after = session(jobs);
		restore(after.interp, image);
		const run = (code: string) => runAsync(after.interp, code);
		await run('(send :to "r" "again")');
		expect(jobs.submitted[0]).toMatchObject({ agent: "agent-1" });
		jobs.forgotten.add("job-1");
		expect(str((await run('(job-state "job-1")')).value)).toBe(":failed");
		await expect(run('(job-wait "job-1")')).rejects.toThrow("interrupted");
	});
});
