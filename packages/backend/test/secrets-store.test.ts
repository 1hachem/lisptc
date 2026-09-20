import { type FunctionReference, getFunctionName } from "convex/server";
import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api.js";
import type { Id } from "../convex/_generated/dataModel.js";
import {
	ConvexSecretsStore,
	type SecretsClient,
	type StoredSecret,
} from "../src/secrets-store.ts";

function named(reference: unknown): string {
	return getFunctionName(reference as FunctionReference<"query" | "mutation">);
}

const WORKSPACE = "workspace-1" as Id<"workspaces">;

function spyClient(
	rows: StoredSecret[] = [],
	put: (secret: StoredSecret) => void = () => {},
): { client: SecretsClient; saved: StoredSecret[] } {
	const saved: StoredSecret[] = [];
	const answer = (reference: unknown, args: Record<string, unknown>) => {
		const name = named(reference);
		if (name === named(api.secrets.list)) return Promise.resolve(rows);
		if (name === named(api.secrets.put)) {
			const secret = args.secret as StoredSecret;
			put(secret);
			saved.push(secret);
		}
		return Promise.resolve(null);
	};
	return {
		saved,
		client: { query: answer, mutation: answer } as unknown as SecretsClient,
	};
}

function open(client: SecretsClient): Promise<ConvexSecretsStore> {
	return ConvexSecretsStore.open(WORKSPACE, () => client);
}

describe("the convex secrets store", () => {
	it("serves what the workspace already held", async () => {
		const { client } = spyClient([
			{ key: "REPL_TOKEN", value: "hydrated", description: "from convex" },
		]);
		const store = await open(client);

		expect(store.get("REPL_TOKEN")).toEqual({
			value: "hydrated",
			description: "from convex",
		});
		expect(store.list()).toEqual([["REPL_TOKEN", "from convex"]]);
	});

	it("answers a read before the write has landed", async () => {
		const { client, saved } = spyClient();
		const store = await open(client);

		store.set({ REPL_TOKEN: "just set" });

		expect(store.get("REPL_TOKEN")?.value).toEqual("just set");
		await store.flush();
		expect(saved).toEqual([
			{ key: "REPL_TOKEN", value: "just set", description: "" },
		]);
	});

	it("sends nothing for a key the port would drop", async () => {
		const { client, saved } = spyClient();
		const store = await open(client);

		store.set({ TOKEN: "unprefixed" });

		await store.flush();
		expect(store.get("TOKEN")).toBeUndefined();
		expect(saved).toEqual([]);
	});

	it("survives a write the deployment refused", async () => {
		const { client } = spyClient([], () => {
			throw new Error("TOO_MANY_SECRETS");
		});
		const store = await open(client);

		store.set({ REPL_TOKEN: "rejected" });

		await expect(store.flush()).resolves.toBeUndefined();
		expect(store.get("REPL_TOKEN")?.value).toEqual("rejected");
	});
});
