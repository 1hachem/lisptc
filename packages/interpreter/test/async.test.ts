import { describe, expect, it } from "vitest";
import { AsyncWork } from "../src/async.ts";

describe("AsyncWork tracks the promises it is handed", () => {
	it("reports a started promise as pending, then fulfilled", async () => {
		const work = new AsyncWork();
		const p = work.start(async () => 1);
		expect(work.stateOf(p)).toBe("pending");
		expect(work.pending()).toEqual([p]);
		await p;
		await Promise.resolve();
		expect(work.stateOf(p)).toBe("fulfilled");
		expect(work.pending()).toEqual([]);
	});

	it("reports a rejected promise as rejected", async () => {
		const work = new AsyncWork();
		const p = work.watch(Promise.reject(new Error("no")));
		await expect(p).rejects.toThrow("no");
		await Promise.resolve();
		expect(work.stateOf(p)).toBe("rejected");
		expect(work.pending()).toEqual([]);
	});

	it("says unknown for a promise it never saw", () => {
		expect(new AsyncWork().stateOf(Promise.resolve())).toBe("unknown");
	});

	it("does not record a watched promise twice", () => {
		const work = new AsyncWork();
		const p = work.start(() => new Promise(() => {}));
		expect(work.watch(p)).toBe(p);
		expect(work.pending()).toEqual([p]);
	});

	it("cancels a started promise through its signal", () => {
		const work = new AsyncWork();
		let signal: AbortSignal | undefined;
		const p = work.start((s) => {
			signal = s;
			return new Promise(() => {});
		});
		expect(work.cancel(p)).toBe(true);
		expect(signal?.aborted).toBe(true);
		expect(work.pending()).toEqual([]);
	});

	it("cannot cancel a promise it only watches", () => {
		const work = new AsyncWork();
		const p = work.watch(new Promise(() => {}));
		expect(work.cancel(p)).toBe(false);
		expect(work.pending()).toEqual([]);
	});

	it("aborts every live started promise", () => {
		const work = new AsyncWork();
		const signals: AbortSignal[] = [];
		work.start((s) => {
			signals.push(s);
			return new Promise(() => {});
		});
		work.watch(new Promise(() => {}));
		work.abortAll();
		expect(signals.map((s) => s.aborted)).toEqual([true]);
		expect(work.pending()).toEqual([]);
	});
});
