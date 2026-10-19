import { getFunctionName } from "convex/server";
import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api.js";
import type { Id } from "../convex/_generated/dataModel.js";
import { type AgentClient, ConvexAgentStore } from "../src/agent-store.ts";
import { harness, signIn } from "./helpers.ts";

const WORKSPACE = "workspace-1" as Id<"workspaces">;

function named(reference: unknown): string {
	return getFunctionName(reference as Parameters<typeof getFunctionName>[0]);
}

function spyClient(rows: { name: string; prompt: string }[]) {
	const calls: { name: string; args: Record<string, unknown> }[] = [];
	const answer = (reference: unknown, args: Record<string, unknown>) => {
		const name = named(reference);
		calls.push({ name, args });
		if (name === named(api.agents.list))
			return Promise.resolve(
				rows.map((row) => ({ ...row, _id: "a", workspaceId: WORKSPACE })),
			);
		if (name === named(api.agents.remove)) return Promise.resolve(true);
		return Promise.resolve(null);
	};
	return {
		calls,
		client: { query: answer, mutation: answer } as unknown as AgentClient,
	};
}

describe("the convex agent store", () => {
	it("reads a definition by name, without the row's bookkeeping", async () => {
		const { client } = spyClient([{ name: "researcher", prompt: "dig" }]);
		const store = new ConvexAgentStore(WORKSPACE, () => client);
		expect(await store.get("researcher")).toEqual({
			name: "researcher",
			prompt: "dig",
		});
		expect(await store.get("ghost")).toBeUndefined();
	});

	it("writes a definition to its workspace", async () => {
		const { client, calls } = spyClient([]);
		const store = new ConvexAgentStore(WORKSPACE, () => client);
		await store.put({ name: "researcher", prompt: "dig" });
		expect(calls).toEqual([
			{
				name: named(api.agents.put),
				args: {
					workspaceId: WORKSPACE,
					agent: { name: "researcher", prompt: "dig" },
				},
			},
		]);
	});

	it("round-trips through the deployment", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const store = new ConvexAgentStore(
			alice.workspace,
			() => alice.as as unknown as AgentClient,
		);
		await store.put({ name: "researcher", prompt: "dig" });
		expect(await store.all()).toEqual([{ name: "researcher", prompt: "dig" }]);
		expect(await store.delete("researcher")).toBe(true);
		expect(await store.all()).toEqual([]);
	});
});
