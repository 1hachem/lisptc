import { describe, expect, test } from "vitest";
import { delayOf } from "../src/backoff.ts";
import { world } from "./helpers.ts";

describe("backoff", () => {
	test("compute constant, linear and exponential waits", () => {
		const base = { base: 100, factor: 2, jitter: 0 };
		const waits = (kind: "constant" | "linear" | "exponential", factor = 2) =>
			[0, 1, 2, 3].map((n) => delayOf({ ...base, kind, factor }, n, 0.5));
		expect(waits("constant")).toEqual([100, 100, 100, 100]);
		expect(waits("linear", 50)).toEqual([100, 150, 200, 250]);
		expect(waits("exponential")).toEqual([100, 200, 400, 800]);
	});

	test("cap at :max and spread by :jitter", () => {
		const spec = {
			kind: "exponential" as const,
			base: 100,
			factor: 2,
			max: 300,
			jitter: 0.5,
		};
		expect(delayOf(spec, 0, 0)).toBe(50);
		expect(delayOf(spec, 0, 1)).toBe(150);
		expect(delayOf(spec, 5, 1)).toBe(300);
	});

	test("read a spec back through backoff-delay", async () => {
		const { shown } = world();
		expect(
			await shown("(backoff-delay (backoff :exponential :base 100) 3)"),
		).toBe("800");
		expect(await shown("(backoff-delay (backoff :linear :base 100) 2)")).toBe(
			"300",
		);
		await expect(shown("(backoff :wild)")).rejects.toThrow(":constant");
	});
});

describe("watch macros", () => {
	test("sleep on the host's timer", async () => {
		const { clock, shown } = world();
		expect(await shown("(sleep 250)")).toBe("nil");
		expect(clock.slept).toEqual([250]);
	});

	test("retry with exponential backoff, waiting between attempts", async () => {
		const { clock, shown } = world();
		await shown("(setq tries 0)");
		expect(
			await shown(
				'(retry 5 :backoff (backoff :exponential :base 100 :factor 2 :max 300) (setq tries (+ tries 1)) (if (< tries 4) (error "not yet") tries))',
			),
		).toBe("4");
		expect(clock.slept).toEqual([100, 200, 300]);
	});

	test("retry with jitter drawn from the host", async () => {
		const { clock, shown } = world(1);
		await shown("(setq tries 0)");
		await shown(
			'(retry 3 :backoff (backoff :constant :base 100 :jitter 0.2) (setq tries (+ tries 1)) (if (< tries 3) (error "no") tries))',
		);
		expect(clock.slept).toEqual([120, 120]);
	});

	test("retry raises the last error once attempts run out", async () => {
		const { clock, shown } = world();
		await expect(shown('(retry 2 (error "always"))')).rejects.toThrow("always");
		expect(clock.slept).toEqual([]);
	});

	test("poll until the test holds, every interval", async () => {
		const { clock, shown } = world();
		await shown("(setq n 0)");
		expect(
			await shown(
				"(poll-until (progn (setq n (+ n 1)) (if (= n 3) n nil)) :every 500)",
			),
		).toBe("3");
		expect(clock.slept).toEqual([500, 500]);
	});

	test("poll stops at its timeout", async () => {
		const { clock, shown } = world();
		await expect(
			shown("(poll-until nil :every 400 :timeout 1000)"),
		).rejects.toThrow("timed out");
		expect(clock.slept).toEqual([400, 400, 200]);
	});

	test("watch an expression until a predicate accepts it", async () => {
		const { clock, shown } = world();
		await shown("(setq n 0)");
		expect(
			await shown(
				"(watch-until (setq n (+ n 1)) (lambda (v) (> v 2)) :every 100 :timeout 1000)",
			),
		).toBe("3");
		expect(clock.slept).toEqual([100, 100]);
	});

	test("run every interval a set number of times", async () => {
		const { clock, shown } = world();
		await shown("(setq n 0)");
		expect(await shown("(every 1000 :times 3 (setq n (+ n 1)))")).toBe(
			"(1 2 3)",
		);
		expect(clock.slept).toEqual([1000, 1000]);
	});

	test("give up a body that waits past its timeout", async () => {
		const { shown } = world();
		expect(await shown("(with-timeout 50 (sleep 10) :ok)")).toBe(":ok");
		await expect(shown("(with-timeout 50 (sleep 100) :late)")).rejects.toThrow(
			"timed out",
		);
	});
});
