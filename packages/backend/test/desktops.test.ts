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
			machineId: "m1",
			connection: "c1",
			label: "laptop",
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
			machineId: "m1",
			connection: "c1",
			label: "laptop",
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
			machineId: "m1",
			connection: "old",
			label: "laptop",
			instance: "i1",
		});
		await t.mutation(internal.desktops.attach, {
			userId: alice.user,
			machineId: "m1",
			connection: "new",
			label: "laptop",
			instance: "i2",
		});
		await t.mutation(internal.desktops.detach, {
			userId: alice.user,
			machineId: "m1",
			connection: "old",
		});
		expect(await alice.as.query(api.desktops.mine, {})).toEqual({
			connected: true,
		});
		await t.mutation(internal.desktops.detach, {
			userId: alice.user,
			machineId: "m1",
			connection: "new",
		});
		expect(await alice.as.query(api.desktops.mine, {})).toEqual({
			connected: false,
		});
	});

	it("keeps one row per account however often its desktop reconnects", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		for (const connection of ["c1", "c2", "c3"]) {
			await t.mutation(internal.desktops.attach, {
				userId: alice.user,
				machineId: "m1",
				connection,
				label: "laptop",
				instance: "i1",
			});
			await t.mutation(internal.desktops.detach, {
				userId: alice.user,
				machineId: "m1",
				connection,
			});
		}
		await t.mutation(internal.desktops.attach, {
			userId: alice.user,
			machineId: "m1",
			connection: "c4",
			label: "laptop",
			instance: "i1",
		});
		const rows = await t.run((ctx) => ctx.db.query("desktops").collect());
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ connection: "c4", connected: true });
	});

	it("keeps two machines of one account apart, and is on while either is", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		for (const machineId of ["laptop", "tower"])
			await t.mutation(internal.desktops.attach, {
				userId: alice.user,
				machineId,
				label: machineId,
				connection: machineId,
				instance: "i1",
			});
		await t.mutation(internal.desktops.detach, {
			userId: alice.user,
			machineId: "laptop",
			connection: "laptop",
		});
		expect(await alice.as.query(api.desktops.mine, {})).toEqual({
			connected: true,
		});
		const rows = await t.run((ctx) => ctx.db.query("desktops").collect());
		expect(rows.map((row) => [row.machineId, row.connected])).toEqual([
			["laptop", false],
			["tower", true],
		]);
	});

	it("marks a desktop gone when its connection stopped pinging, and keeps a pinging one", async () => {
		vi.useFakeTimers();
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const bob = await signIn(t, "bob@example.com");
		await t.mutation(internal.desktops.attach, {
			userId: alice.user,
			machineId: "m1",
			connection: "a",
			label: "laptop",
			instance: "crashed",
		});
		await t.mutation(internal.desktops.attach, {
			userId: bob.user,
			machineId: "m1",
			connection: "b",
			label: "laptop",
			instance: "alive",
		});
		vi.advanceTimersByTime(DESKTOP_STALE_MS + 1);
		await t.mutation(internal.desktops.seen, {
			userId: bob.user,
			machineId: "m1",
			connection: "b",
		});
		await t.mutation(internal.desktops.sweep, {});
		expect(await alice.as.query(api.desktops.mine, {})).toEqual({
			connected: false,
		});
		expect(await bob.as.query(api.desktops.mine, {})).toEqual({
			connected: true,
		});
	});
});
