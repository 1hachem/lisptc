import type { Clock } from "@repo/shared/host";
import { describe, expect, it } from "vitest";
import { driveSync, settled } from "../src/drive.ts";
import { type Phase, timed, timedEval } from "../src/timed.ts";

function ticking(start: number, step: number): Clock {
	let t = start - step;
	return { now: () => (t += step) };
}

function phases() {
	const seen: [Phase, unknown][] = [];
	return {
		seen,
		report: (phase: Phase, value?: unknown) => {
			seen.push([phase, value]);
		},
	};
}

describe("timed", () => {
	it("reports the start, then how long the call took with its value", async () => {
		const { seen, report } = phases();
		expect(
			await timed(ticking(1000, 25), () => Promise.resolve("ok"), report),
		).toBe("ok");
		expect(seen).toEqual([
			[{ state: "started", startedAt: 1000 }, undefined],
			[{ state: "done", startedAt: 1000, ms: 25 }, "ok"],
		]);
	});

	it("reports how long a failing call took and rethrows its error", async () => {
		const { seen, report } = phases();
		const boom = new Error("boom");
		await expect(
			timed(ticking(1000, 40), () => Promise.reject(boom), report),
		).rejects.toBe(boom);
		expect(seen.at(-1)).toEqual([
			{ state: "failed", startedAt: 1000, ms: 40, error: boom },
			undefined,
		]);
	});

	it("times a call that throws before it returns a promise", async () => {
		const { seen, report } = phases();
		const boom = new Error("boom");
		await expect(
			timed(
				ticking(1000, 10),
				() => {
					throw boom;
				},
				report,
			),
		).rejects.toBe(boom);
		expect(seen.map(([phase]) => phase.state)).toEqual(["started", "failed"]);
	});
});

describe("timedEval", () => {
	it("times a generator-driven call the same way", () => {
		const { seen, report } = phases();
		const value = driveSync(
			timedEval(ticking(500, 5), () => settled(7), report),
		);
		expect(value).toBe(7);
		expect(seen).toEqual([
			[{ state: "started", startedAt: 500 }, undefined],
			[{ state: "done", startedAt: 500, ms: 5 }, 7],
		]);
	});
});
