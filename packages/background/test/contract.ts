import { describe, expect, test } from "vitest";
import type { BackgroundJobs, JobSpec } from "../src/ports.ts";

export interface ContractWorld {
	readonly jobs: BackgroundJobs;
	readonly parent: string;
}

function spec(parent: string, code: string): JobSpec {
	return { parent, code, fork: null, permissions: null, deadlineSeconds: null };
}

export function backgroundJobsContract(
	name: string,
	open: () => Promise<ContractWorld>,
): void {
	describe(`${name} keeps the background jobs contract`, () => {
		test("start a job from a spec that went through JSON and wait for its value", async () => {
			const { jobs, parent } = await open();
			const sent = JSON.parse(JSON.stringify(spec(parent, "(+ 40 2)")));
			const job = await jobs.start(sent);
			expect(await jobs.wait(job, new AbortController().signal)).toEqual({
				value: "42",
			});
			expect((await jobs.state(job)).state).toBe("done");
		});

		test("report a job whose code raises as failed", async () => {
			const { jobs, parent } = await open();
			const job = await jobs.start(spec(parent, '(error "boom")'));
			const outcome = await jobs.wait(job, new AbortController().signal);
			expect(outcome).toMatchObject({
				failure: expect.stringContaining("boom"),
			});
			expect((await jobs.state(job)).state).toBe("failed");
		});

		test("give every start a fresh id", async () => {
			const { jobs, parent } = await open();
			const a = await jobs.start(spec(parent, "1"));
			const b = await jobs.start(spec(parent, "2"));
			expect(a).not.toBe(b);
		});

		test("cancel a job that sleeps", async () => {
			const { jobs, parent } = await open();
			const job = await jobs.start(spec(parent, "(sleep 600000)"));
			expect(await jobs.cancel(job)).toBe(true);
			expect((await jobs.state(job)).state).toBe("cancelled");
		});

		test("read an unknown job as lost", async () => {
			const { jobs } = await open();
			expect((await jobs.state("never-started")).state).toBe("lost");
		});

		test("refuse a sleep whose signal is aborted", async () => {
			const { jobs } = await open();
			const stop = new AbortController();
			stop.abort();
			await expect(jobs.sleep(10, stop.signal)).rejects.toBeDefined();
		});
	});
}
