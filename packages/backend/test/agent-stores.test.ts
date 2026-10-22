import { type FunctionReference, getFunctionName } from "convex/server";
import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api.js";
import type { Id } from "../convex/_generated/dataModel.js";
import {
	ConvexKnowledgeStore,
	type KnowledgeStoreClient,
} from "../src/knowledge-store.ts";
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
	client: WorkspaceStoreClient & PreferencesClient & KnowledgeStoreClient;
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
			url: "http://convex-backend:3210",
		} as unknown as WorkspaceStoreClient &
			PreferencesClient &
			KnowledgeStoreClient,
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

describe("the convex knowledge store", () => {
	it("reads an uploaded file at the deployment the store reaches, whatever origin it was served on", async () => {
		const { client } = spyClient({
			[named(api.knowledge.get)]: {
				name: "a.md",
				url: "https://convex.example.ts.net/api/storage/a",
			},
		});
		const fetched: string[] = [];
		const store = new ConvexKnowledgeStore(WORKSPACE, () => client, {
			download: async (url) => {
				fetched.push(url);
				return new TextEncoder().encode("# a");
			},
			upload: async () => "never" as Id<"_storage">,
		});
		expect(new TextDecoder().decode(await store.file("a.md"))).toBe("# a");
		expect(fetched).toEqual(["http://convex-backend:3210/api/storage/a"]);
	});

	it("writes a file by uploading the blob and recording it", async () => {
		const { client, sent } = spyClient({
			[named(api.knowledge.uploadUrl)]:
				"https://convex.example.ts.net/api/storage/upload?token=t",
		});
		const uploaded: Array<[string, string, string]> = [];
		const store = new ConvexKnowledgeStore(WORKSPACE, () => client, {
			download: async () => new Uint8Array(),
			upload: async (url, blob) => {
				uploaded.push([url, blob.type, await blob.text()]);
				return "blob-1" as Id<"_storage">;
			},
		});
		await store.write("a.md", "# a", "text/markdown");
		expect(uploaded).toEqual([
			[
				"http://convex-backend:3210/api/storage/upload?token=t",
				"text/markdown",
				"# a",
			],
		]);
		expect(sent.at(-1)).toEqual([
			named(api.knowledge.add),
			{
				workspaceId: WORKSPACE,
				name: "a.md",
				storageId: "blob-1",
				contentType: "text/markdown",
			},
		]);
	});

	it("raises the refusal a write comes back with", async () => {
		const { client } = spyClient({
			[named(api.knowledge.uploadUrl)]:
				"https://convex.example.ts.net/api/storage/upload?token=t",
			[named(api.knowledge.add)]: "FILE_TOO_LARGE",
		});
		const store = new ConvexKnowledgeStore(WORKSPACE, () => client, {
			download: async () => new Uint8Array(),
			upload: async () => "blob-1" as Id<"_storage">,
		});
		await expect(store.write("a.md", "x", "text/markdown")).rejects.toThrow(
			/FILE_TOO_LARGE/,
		);
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
