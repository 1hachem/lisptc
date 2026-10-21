import { type FunctionReference, getFunctionName } from "convex/server";
import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api.js";
import type { Id } from "../convex/_generated/dataModel.js";
import {
	ConvexPreferencesStore,
	type PreferencesClient,
} from "../src/preferences-store.ts";
import {
	ConvexWorkspaceStore,
	OFFERED_MODELS,
	type WorkspaceStoreClient,
} from "../src/workspace-store.ts";

function named(reference: unknown): string {
	return getFunctionName(reference as FunctionReference<"query" | "mutation">);
}

const WORKSPACE = "workspace-1" as Id<"workspaces">;

function spyClient(answers: Record<string, unknown>): {
	client: WorkspaceStoreClient & PreferencesClient;
	sent: Array<[string, Record<string, unknown>]>;
} {
	const sent: Array<[string, Record<string, unknown>]> = [];
	const answer = (reference: unknown, args: Record<string, unknown>) => {
		const name = named(reference);
		sent.push([name, args]);
		return Promise.resolve(answers[name] ?? null);
	};
	return {
		sent,
		client: {
			query: answer,
			mutation: answer,
		} as unknown as WorkspaceStoreClient & PreferencesClient,
	};
}

describe("the convex workspace store", () => {
	it("names the model as provider/model, falling back to the default", async () => {
		const { client } = spyClient({
			[named(api.workspaces.get)]: { name: "personal" },
		});
		const store = new ConvexWorkspaceStore(WORKSPACE, () => client);
		expect((await store.settings()).name).toBe("personal");
		expect(OFFERED_MODELS).toContain((await store.settings()).model);
	});

	it("sends a chosen model as the catalogued choice it names", async () => {
		const { client, sent } = spyClient({});
		const store = new ConvexWorkspaceStore(WORKSPACE, () => client);
		const model = OFFERED_MODELS[0] ?? "";
		await store.choose(model);
		const [, args] = sent.at(-1) ?? ["", {}];
		const choice = args.model as { provider: string; model: string };
		expect(`${choice.provider}/${choice.model}`).toBe(model);
	});

	it("refuses a model the catalogue does not hold", async () => {
		const { client, sent } = spyClient({});
		const store = new ConvexWorkspaceStore(WORKSPACE, () => client);
		await expect(store.choose("openai/gpt-9")).rejects.toThrow(/not offered/);
		expect(sent).toEqual([]);
	});
});

describe("the convex preferences store", () => {
	it("reads what the app stored, leaving the app's own bookkeeping out", async () => {
		const { client } = spyClient({
			[named(api.preferences.get)]: {
				theme: "borland",
				themeUses: { borland: 3 },
				channels: { lisp: true },
				input: { lisp: false },
				hidden: ["tests"],
			},
		});
		const store = new ConvexPreferencesStore(() => client);
		expect(await store.read()).toEqual({
			theme: "borland",
			font: undefined,
			channels: { lisp: true },
			metadata: undefined,
			input: { lisp: false },
			hidden: ["tests"],
		});
	});
});
