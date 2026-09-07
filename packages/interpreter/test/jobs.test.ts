import { describe, expect, it } from "vitest";
import { Job, Jobs, type JobsRuntime } from "../src/jobs.ts";
import type { JobSettledMessage, SettledReply } from "../src/jobs-protocol.ts";
import { Interp, newSym, prelude, run, str } from "../src/lisp.ts";

class FakeRuntime implements JobsRuntime {
	settledHandler: ((msg: JobSettledMessage) => void) | undefined;
	awaitJobReply: (jobId: string) => unknown = () => {
		throw new Error("unexpected await");
	};
	awaitAllReply: { results: SettledReply[] } = { results: [] };
	awaitAnyReply: SettledReply = { jobId: "", ok: true, v: null };
	statuses = new Map<string, string>();
	statusCalls = 0;

	call(): unknown {
		throw new Error("unexpected call");
	}

	start(): string {
		return "fake-job";
	}

	awaitJob(jobId: string): unknown {
		return this.awaitJobReply(jobId);
	}

	awaitAll(): { results: SettledReply[] } {
		return this.awaitAllReply;
	}

	awaitAny(): SettledReply {
		return this.awaitAnyReply;
	}

	jobStatus(jobId: string): string {
		this.statusCalls++;
		return this.statuses.get(jobId) ?? "pending";
	}

	cancelJob(_jobId: string): void {}

	onSettled(handler: (msg: JobSettledMessage) => void): void {
		this.settledHandler = handler;
	}

	shutdown(): void {}
}

function setup() {
	const runtime = new FakeRuntime();
	const jobs = new Jobs(runtime, (raw) => raw);
	const interp = new Interp();
	run(interp, prelude);
	jobs.installBuiltins(interp);
	const track = (name: string, job: Job): Job => {
		jobs.track(job);
		interp.defineGlobal(newSym(name), job);
		return job;
	};
	const ev = (code: string): string => str(run(interp, code));
	return { runtime, track, ev, run: (code: string) => run(interp, code) };
}

describe("await-all", () => {
	it("maps a failed job to an (:error reason) entry and keeps the others in order", () => {
		const { runtime, track, ev } = setup();
		runtime.awaitAllReply = {
			results: [
				{ jobId: "g", ok: true, v: "first" },
				{ jobId: "b", ok: false, e: "connect failed" },
			],
		};
		track("good", new Job("g", "load-mcp:good"));
		track("bad", new Job("b", "load-mcp:bad"));
		expect(ev("(await-all (list good bad))")).toBe(
			'("first" (:error "connect failed"))',
		);
	});

	it("returns nil for an empty list without asking the runtime", () => {
		const { ev } = setup();
		expect(ev("(await-all nil)")).toBe("nil");
	});

	it("rejects a list holding something that is not a job", () => {
		const { run } = setup();
		expect(() => run('(await-all (list "nope"))')).toThrow(/not a job/);
	});
});

describe("await-any", () => {
	it("re-raises the error of the job that settled first", () => {
		const { runtime, track, run } = setup();
		runtime.awaitAnyReply = { jobId: "b", ok: false, e: "connect failed" };
		track("bad", new Job("b", "load-mcp:bad"));
		expect(() => run("(await-any (list bad))")).toThrow(
			/job error: connect failed/,
		);
	});

	it("demands at least one job", () => {
		const { run } = setup();
		expect(() => run("(await-any nil)")).toThrow(/await-any: no jobs/);
	});

	it("rejects a non-job in the list", () => {
		const { run } = setup();
		expect(() => run("(await-any (list 7))")).toThrow(/not a job/);
	});
});

describe("await", () => {
	it("rejects a timeout that is not a number of milliseconds", () => {
		const { runtime, track, run } = setup();
		runtime.awaitJobReply = () => 1;
		track("j", new Job("j", "load-mcp:j"));
		expect(() => run('(await j "soon")')).toThrow(/invalid await timeout/);
	});
});

describe("settled push", () => {
	it("applies a job's result without an explicit await, once, and caches it", () => {
		const { runtime, track, ev } = setup();
		let finalizerRuns = 0;
		const job = track(
			"pushed",
			new Job("p", "load-mcp:push", (raw) => {
				finalizerRuns++;
				return `${raw}!`;
			}),
		);
		runtime.settledHandler?.({
			type: "job-settled",
			jobId: "p",
			ok: true,
			v: "result",
		});
		expect(ev("(await pushed)")).toBe('"result!"');
		expect(finalizerRuns).toBe(1);
		expect(ev("(job-status pushed)")).toBe(":done");
		expect(runtime.statusCalls).toBe(0);
		expect(ev("(length (jobs))")).toBe("0");
		expect(ev("(await pushed)")).toBe('"result!"');
		expect(finalizerRuns).toBe(1);
		expect(job.finalized).toBe(true);
	});

	it("ignores a failed settlement, leaving the job to raise on await", () => {
		const { runtime, track, ev } = setup();
		runtime.statuses.set("p", "error");
		const job = track("pushed", new Job("p", "load-mcp:push"));
		runtime.settledHandler?.({
			type: "job-settled",
			jobId: "p",
			ok: false,
		});
		expect(job.finalized).toBe(false);
		expect(ev("(job-status pushed)")).toBe(":error");
	});
});
