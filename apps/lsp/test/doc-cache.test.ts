import { describe, expect, it } from "vitest";
import type { CallDoc } from "../src/call-diagnostics.ts";
import { cachedResolver } from "../src/doc-cache.ts";

function resolverSpy(doc: CallDoc = {}) {
	const calls: string[] = [];
	const resolve = async (name: string): Promise<CallDoc> => {
		calls.push(name);
		return doc;
	};
	return { resolve, calls };
}

describe("cachedResolver", () => {
	it("resolves via the underlying resolver on a cache miss", async () => {
		const { resolve, calls } = resolverSpy({ arity: { min: 1 } });
		const cached = cachedResolver(resolve, 1000);
		expect(await cached("car")).toEqual({ arity: { min: 1 } });
		expect(calls).toEqual(["car"]);
	});

	it("reuses the cached value within the TTL without calling the resolver again", async () => {
		const { resolve, calls } = resolverSpy({ arity: { min: 1 } });
		let now = 1000;
		const cached = cachedResolver(resolve, 400, () => now);
		await cached("car");
		now += 399;
		await cached("car");
		expect(calls).toEqual(["car"]);
	});

	it("calls the resolver again once the TTL has elapsed", async () => {
		const { resolve, calls } = resolverSpy({ arity: { min: 1 } });
		let now = 1000;
		const cached = cachedResolver(resolve, 400, () => now);
		await cached("car");
		now += 400;
		await cached("car");
		expect(calls).toEqual(["car", "car"]);
	});

	it("caches each name independently", async () => {
		const { resolve, calls } = resolverSpy({ arity: { min: 1 } });
		const cached = cachedResolver(resolve, 1000);
		await cached("car");
		await cached("cdr");
		await cached("car");
		expect(calls.sort()).toEqual(["car", "cdr"]);
	});
});
