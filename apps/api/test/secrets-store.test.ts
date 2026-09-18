import type { ConvexSecrets, StoredSecret } from "@repo/backend/secrets-store";
import { describe, expect, it } from "vitest";
import { WriteThroughSecretsStore } from "../src/secrets-store.ts";

function fakeRemote(seed: StoredSecret[] = []): ConvexSecrets & {
	saved: StoredSecret[];
} {
	const saved: StoredSecret[] = [];
	return {
		saved,
		load: async () => seed,
		save: async (secret: StoredSecret) => {
			saved.push(secret);
		},
		remove: async () => true,
	} as unknown as ConvexSecrets & { saved: StoredSecret[] };
}

describe("the write-through secrets store", () => {
	it("serves what the workspace already held", async () => {
		const store = await WriteThroughSecretsStore.open(
			fakeRemote([
				{ key: "REPL_TOKEN", value: "hydrated", description: "from convex" },
			]),
		);

		expect(store.get("REPL_TOKEN")).toEqual({
			value: "hydrated",
			description: "from convex",
		});
		expect(store.list()).toEqual([["REPL_TOKEN", "from convex"]]);
	});

	it("answers a read before the write has landed", async () => {
		const remote = fakeRemote();
		const store = await WriteThroughSecretsStore.open(remote);

		store.set({ REPL_TOKEN: "just set" });

		expect(store.get("REPL_TOKEN")?.value).toEqual("just set");
		await store.flush();
		expect(remote.saved).toEqual([
			{ key: "REPL_TOKEN", value: "just set", description: "" },
		]);
	});

	it("sends nothing for a key the port would drop", async () => {
		const remote = fakeRemote();
		const store = await WriteThroughSecretsStore.open(remote);

		store.set({ TOKEN: "unprefixed" });

		await store.flush();
		expect(store.get("TOKEN")).toBeUndefined();
		expect(remote.saved).toEqual([]);
	});

	it("survives a write the deployment refused", async () => {
		const store = await WriteThroughSecretsStore.open({
			load: async () => [],
			save: async () => {
				throw new Error("TOO_MANY_SECRETS");
			},
			remove: async () => true,
		} as unknown as ConvexSecrets);

		store.set({ REPL_TOKEN: "rejected" });

		await expect(store.flush()).resolves.toBeUndefined();
		expect(store.get("REPL_TOKEN")?.value).toEqual("rejected");
	});
});
