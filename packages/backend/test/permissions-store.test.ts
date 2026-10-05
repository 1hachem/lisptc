import { type FunctionReference, getFunctionName } from "convex/server";
import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api.js";
import type { Id } from "../convex/_generated/dataModel.js";
import {
	ConvexPermissionsStore,
	type PermissionsClient,
} from "../src/permissions-store.ts";

function named(reference: unknown): string {
	return getFunctionName(reference as FunctionReference<"query" | "mutation">);
}

const WORKSPACE = "workspace-1" as Id<"workspaces">;

function spyClient(held: string | null): {
	client: PermissionsClient;
	saved: string[];
} {
	const saved: string[] = [];
	const answer = (reference: unknown, args: Record<string, unknown>) => {
		const name = named(reference);
		if (name === named(api.permissions.get)) return Promise.resolve(held);
		if (name === named(api.permissions.put)) saved.push(args.source as string);
		return Promise.resolve(null);
	};
	return {
		saved,
		client: { query: answer, mutation: answer } as unknown as PermissionsClient,
	};
}

describe("the convex permissions store", () => {
	it("serves the config the workspace already held", async () => {
		const { client } = spyClient("(permission/deny eval)");
		const store = await ConvexPermissionsStore.open(WORKSPACE, () => client);
		expect(store.source()).toBe("(permission/deny eval)");
	});

	it("serves an empty config to a workspace that never saved one", async () => {
		const { client } = spyClient(null);
		const store = await ConvexPermissionsStore.open(WORKSPACE, () => client);
		expect(store.source()).toBe("");
	});

	it("writes a config through, and serves it after", async () => {
		const { client, saved } = spyClient(null);
		const store = await ConvexPermissionsStore.open(WORKSPACE, () => client);
		await store.save("(permission/ask eval)");
		expect(saved).toEqual(["(permission/ask eval)"]);
		expect(store.source()).toBe("(permission/ask eval)");
	});

	it("refuses to save a config that does not parse, and keeps the old one", async () => {
		const { client, saved } = spyClient("(permission/deny eval)");
		const store = await ConvexPermissionsStore.open(WORKSPACE, () => client);
		await expect(store.save("(permission/permit eval)")).rejects.toThrow(
			"unknown permissions form",
		);
		expect(saved).toEqual([]);
		expect(store.source()).toBe("(permission/deny eval)");
	});
});
