import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api.js";
import {
	ConvexPermissionsStore,
	type PermissionsClient,
} from "../src/permissions-store.ts";
import { harness, signIn } from "./helpers.ts";

async function workspace(held?: string) {
	const alice = await signIn(harness(), "alice@example.com");
	if (held !== undefined)
		await alice.as.mutation(api.permissions.put, {
			workspaceId: alice.workspace,
			source: held,
		});
	const connect = () => alice.as as unknown as PermissionsClient;
	return () => ConvexPermissionsStore.open(alice.workspace, connect);
}

describe("the convex permissions store", () => {
	it("serves the config the workspace already held", async () => {
		const open = await workspace("(permission/deny eval)");
		expect((await open()).source()).toBe("(permission/deny eval)");
	});

	it("serves an empty config to a workspace that never saved one", async () => {
		const open = await workspace();
		expect((await open()).source()).toBe("");
	});

	it("writes a config through, and serves it after", async () => {
		const open = await workspace();
		const store = await open();
		await store.save("(permission/ask eval)");
		expect(store.source()).toBe("(permission/ask eval)");
		expect((await open()).source()).toBe("(permission/ask eval)");
	});

	it("refuses to save a config that does not parse, and keeps the old one", async () => {
		const open = await workspace("(permission/deny eval)");
		const store = await open();
		await expect(store.save("(permission/permit eval)")).rejects.toThrow(
			"unknown permissions form",
		);
		expect(store.source()).toBe("(permission/deny eval)");
		expect((await open()).source()).toBe("(permission/deny eval)");
	});
});
