import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../convex/_generated/api.js";
import { DESKTOP_STALE_MS } from "../convex/limits.ts";
import { harness, signIn } from "./helpers.ts";

afterEach(() => {
	vi.useRealTimers();
});

describe("a user's desktop presence", () => {
	it("is off until a desktop attaches, and on after", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		expect(await alice.as.query(api.desktops.mine, {})).toEqual({
			connected: false,
		});
		await t.mutation(internal.desktops.attach, {
			userId: alice.user,
			connection: "c1",
			instance: "i1",
		});
		expect(await alice.as.query(api.desktops.mine, {})).toEqual({
			connected: true,
		});
	});

	it("is the caller's own, never another account's", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const bob = await signIn(t, "bob@example.com");
		await t.mutation(internal.desktops.attach, {
			userId: bob.user,
			connection: "c1",
			instance: "i1",
		});
		expect(await alice.as.query(api.desktops.mine, {})).toEqual({
			connected: false,
		});
	});

	it("keeps the newest connection when an older one closes late", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		await t.mutation(internal.desktops.attach, {
			userId: alice.user,
			connection: "old",
			instance: "i1",
		});
		await t.mutation(internal.desktops.attach, {
			userId: alice.user,
			connection: "new",
			instance: "i2",
		});
		await t.mutation(internal.desktops.detach, {
			userId: alice.user,
			connection: "old",
		});
		expect(await alice.as.query(api.desktops.mine, {})).toEqual({
			connected: true,
		});
		await t.mutation(internal.desktops.detach, {
			userId: alice.user,
			connection: "new",
		});
		expect(await alice.as.query(api.desktops.mine, {})).toEqual({
			connected: false,
		});
	});

	it("forgets a desktop whose server stopped beating, and keeps a beating one", async () => {
		vi.useFakeTimers();
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const bob = await signIn(t, "bob@example.com");
		await t.mutation(internal.desktops.attach, {
			userId: alice.user,
			connection: "a",
			instance: "crashed",
		});
		await t.mutation(internal.desktops.attach, {
			userId: bob.user,
			connection: "b",
			instance: "alive",
		});
		vi.advanceTimersByTime(DESKTOP_STALE_MS + 1);
		await t.mutation(internal.desktops.heartbeat, { instance: "alive" });
		await t.mutation(internal.desktops.sweep, {});
		expect(await alice.as.query(api.desktops.mine, {})).toEqual({
			connected: false,
		});
		expect(await bob.as.query(api.desktops.mine, {})).toEqual({
			connected: true,
		});
	});
});
