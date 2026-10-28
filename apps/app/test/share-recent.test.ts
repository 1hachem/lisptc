import { describe, expect, it, vi } from "vitest";

vi.mock("better-auth/react", () => ({
	createAuthClient: () => ({ convex: { token: vi.fn() } }),
}));
vi.mock("@better-auth/passkey/client", () => ({ passkeyClient: () => ({}) }));
vi.mock("@convex-dev/better-auth/client/plugins", () => ({
	convexClient: () => ({}),
}));

const { shareRecent } = await import("../src/lib/auth-client.ts");

describe("the convex token fetch", () => {
	it("is shared by calls that land together, so a page load asks once", async () => {
		let clock = 0;
		const fetch = vi.fn(async () => "jwt");
		const token = shareRecent(fetch, () => clock, 5_000);
		await Promise.all([token(), token()]);
		clock = 1_000;
		await token();
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it("is asked again once the reuse window has passed", async () => {
		let clock = 0;
		const fetch = vi.fn(async () => "jwt");
		const token = shareRecent(fetch, () => clock, 5_000);
		await token();
		clock = 5_000;
		await token();
		expect(fetch).toHaveBeenCalledTimes(2);
	});

	it("does not keep a failed fetch", async () => {
		const fetch = vi
			.fn<() => Promise<string>>()
			.mockRejectedValueOnce(new Error("offline"))
			.mockResolvedValue("jwt");
		const token = shareRecent(fetch, () => 0, 5_000);
		await expect(token()).rejects.toThrow("offline");
		await expect(token()).resolves.toBe("jwt");
	});
});
