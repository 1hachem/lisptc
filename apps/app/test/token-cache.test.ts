import { describe, expect, it, vi } from "vitest";
import { tokenCache } from "../src/lib/convex-auth.ts";

function jwt(expSeconds: number): string {
	const payload = btoa(JSON.stringify({ exp: expSeconds }))
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
	return `header.${payload}.signature`;
}

const HOUR = 3_600_000;

describe("convex token cache", () => {
	it("serves the seeded token without fetching until near its expiry", async () => {
		let clock = 0;
		const seed = jwt(HOUR / 1000);
		const fetch = vi.fn(async () => jwt((2 * HOUR) / 1000));
		const cache = tokenCache(fetch, () => clock, seed);
		expect(await cache.get(false)).toBe(seed);
		clock = HOUR - 120_000;
		expect(await cache.get(false)).toBe(seed);
		expect(fetch).not.toHaveBeenCalled();
		clock = HOUR - 30_000;
		expect(await cache.get(false)).toBe(jwt((2 * HOUR) / 1000));
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it("fetches when forced even while the token is fresh", async () => {
		const fetch = vi.fn(async () => "fresh");
		const cache = tokenCache(fetch, () => 0, jwt(HOUR / 1000));
		expect(await cache.get(true)).toBe("fresh");
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it("shares one fetch between concurrent callers", async () => {
		const fetch = vi.fn(async () => jwt(HOUR / 1000));
		const cache = tokenCache(fetch, () => 0);
		const [a, b] = await Promise.all([cache.get(false), cache.get(false)]);
		expect(a).toBe(b);
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it("does not keep a failed fetch", async () => {
		const fetch = vi
			.fn<() => Promise<string | null>>()
			.mockRejectedValueOnce(new Error("down"))
			.mockResolvedValueOnce(jwt(HOUR / 1000));
		const cache = tokenCache(fetch, () => 0);
		expect(await cache.get(false)).toBeNull();
		expect(await cache.get(false)).toBe(jwt(HOUR / 1000));
		expect(fetch).toHaveBeenCalledTimes(2);
	});

	it("forgets the token on sign out, even one still in flight", async () => {
		let release: (token: string) => void = () => undefined;
		const fetch = vi.fn(
			() =>
				new Promise<string | null>((resolve) => {
					release = resolve;
				}),
		);
		const cache = tokenCache(fetch, () => 0, jwt(HOUR / 1000));
		cache.clear();
		expect(cache.peek()).toBeNull();
		const pending = cache.get(false);
		cache.clear();
		release(jwt(HOUR / 1000));
		await pending;
		expect(cache.peek()).toBeNull();
	});
});
