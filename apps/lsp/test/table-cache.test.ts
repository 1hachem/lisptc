import { describe, expect, it } from "vitest";
import { cachedFor } from "../src/table-cache.ts";

function loaderSpy(fails = false) {
	let calls = 0;
	const load = async (): Promise<number> => {
		calls += 1;
		if (fails) throw new Error("down");
		return calls;
	};
	return { load, calls: () => calls };
}

describe("cachedFor", () => {
	it("loads on a cache miss", async () => {
		const { load, calls } = loaderSpy();
		expect(await cachedFor(load, 1000)()).toBe(1);
		expect(calls()).toBe(1);
	});

	it("reuses the value within the TTL without loading again", async () => {
		const { load, calls } = loaderSpy();
		let now = 1000;
		const cached = cachedFor(load, 400, () => now);
		await cached();
		now += 399;
		expect(await cached()).toBe(1);
		expect(calls()).toBe(1);
	});

	it("loads again once the TTL has elapsed", async () => {
		const { load, calls } = loaderSpy();
		let now = 1000;
		const cached = cachedFor(load, 400, () => now);
		await cached();
		now += 400;
		expect(await cached()).toBe(2);
		expect(calls()).toBe(2);
	});

	it("does not keep a failed load", async () => {
		const { load, calls } = loaderSpy(true);
		const cached = cachedFor(load, 1000);
		await expect(cached()).rejects.toThrow("down");
		await expect(cached()).rejects.toThrow("down");
		expect(calls()).toBe(2);
	});
});
