import { type FunctionReference, getFunctionName } from "convex/server";
import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api.js";
import type { Id } from "../convex/_generated/dataModel.js";
import {
	ConvexSecretsStore,
	type SecretsClient,
	type StoredSecret,
} from "../src/secrets-store.ts";
import { signIn, testDeployment } from "./helpers.ts";

function named(reference: unknown): string {
	return getFunctionName(reference as FunctionReference<"query" | "mutation">);
}

const WORKSPACE = "workspace-1" as Id<"workspaces">;

function spyClient(put: (secret: StoredSecret) => void): {
	client: SecretsClient;
} {
	const answer = (reference: unknown, args: Record<string, unknown>) => {
		const name = named(reference);
		if (name === named(api.secrets.list)) return Promise.resolve([]);
		if (name === named(api.secrets.put)) put(args.secret as StoredSecret);
		return Promise.resolve(null);
	};
	return {
		client: { query: answer, mutation: answer } as unknown as SecretsClient,
	};
}

function open(client: SecretsClient): Promise<ConvexSecretsStore> {
	return ConvexSecretsStore.open(WORKSPACE, () => client);
}

describe("the convex secrets store", () => {
	it("serves what the workspace already held", async () => {
		const alice = await signIn(testDeployment(), "alice@example.com");
		await alice.as.mutation(api.secrets.put, {
			workspaceId: alice.workspace,
			secret: { key: "REPL_TOKEN", value: "held", description: "from convex" },
		});
		const store = await ConvexSecretsStore.open(
			alice.workspace,
			() => alice.as as unknown as SecretsClient,
		);

		expect(store.get("REPL_TOKEN")).toEqual({
			value: "held",
			description: "from convex",
		});
		expect(store.list()).toEqual([["REPL_TOKEN", "from convex"]]);
	});

	it("stores nothing for a key the port would drop", async () => {
		const alice = await signIn(testDeployment(), "alice@example.com");
		const store = await ConvexSecretsStore.open(
			alice.workspace,
			() => alice.as as unknown as SecretsClient,
		);

		store.set({ TOKEN: "unprefixed" });

		await store.flush();
		expect(store.get("TOKEN")).toBeUndefined();
		expect(
			await alice.as.query(api.secrets.list, { workspaceId: alice.workspace }),
		).toEqual([]);
	});

	it("survives a write the deployment refused", async () => {
		const { client } = spyClient(() => {
			throw new Error("TOO_MANY_SECRETS");
		});
		const store = await open(client);

		store.set({ REPL_TOKEN: "rejected" });

		await expect(store.flush()).resolves.toBeUndefined();
		expect(store.get("REPL_TOKEN")?.value).toEqual("rejected");
	});
});
