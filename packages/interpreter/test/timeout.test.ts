import { describe, expect, it } from "vitest";
import { EvalException } from "../src/errors.ts";
import { withTimeout } from "../src/timeout.ts";

describe("withTimeout", () => {
	it("hands back the promise itself when there is no finite limit", () => {
		const p = Promise.resolve(1);
		expect(withTimeout(p, Number.POSITIVE_INFINITY, "x")).toBe(p);
	});

	it("resolves with the promise when it settles in time", async () => {
		expect(await withTimeout(Promise.resolve(2), 1000, "x")).toBe(2);
	});

	it("rejects once the limit passes", async () => {
		const late = withTimeout(new Promise(() => {}), 5, "fetch");
		await expect(late).rejects.toBeInstanceOf(EvalException);
		await expect(late).rejects.toThrow("fetch timed out: 5");
	});

	it("names the work still running when it says what it is doing", async () => {
		const late = withTimeout(
			new Promise(() => {}),
			5,
			"await",
			() => "fetching",
		);
		await expect(late).rejects.toThrow(
			"await timed out after 0.005s while the work kept running: fetching. It goes on by itself, so await the same promise again to keep waiting",
		);
	});

	it("keeps the plain message when the work says nothing", async () => {
		const late = withTimeout(
			new Promise(() => {}),
			5,
			"await",
			() => undefined,
		);
		await expect(late).rejects.toThrow("await timed out: 5");
	});
});
