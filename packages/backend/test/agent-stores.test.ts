import { type FunctionReference, getFunctionName } from "convex/server";
import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api.js";
import type { Id } from "../convex/_generated/dataModel.js";
import {
	ConvexKnowledgeStore,
	type KnowledgeStoreClient,
} from "../src/knowledge-store.ts";
import { ConvexLayoutStore } from "../src/layout-store.ts";
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
			[named(api.files.get)]: {
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
		expect(
			new TextDecoder().decode(
				(await store.read("knowledge", "a.md")) ?? new Uint8Array(),
			),
		).toBe("# a");
		expect(fetched).toEqual(["http://convex-backend:3210/api/storage/a"]);
	});

	it("writes a file by uploading the blob and recording it", async () => {
		const { client, sent } = spyClient({
			[named(api.files.uploadUrl)]:
				"https://convex.example.ts.net/api/storage/upload?token=t",
			[named(api.files.add)]: { name: "a.md" },
		});
		const uploaded: Array<[string, string, string]> = [];
		const store = new ConvexKnowledgeStore(WORKSPACE, () => client, {
			download: async () => new Uint8Array(),
			upload: async (url, blob) => {
				uploaded.push([url, blob.type, await blob.text()]);
				return "blob-1" as Id<"_storage">;
			},
		});
		await store.write(
			"knowledge",
			"a.md",
			new TextEncoder().encode("# a"),
			"text/markdown",
		);
		expect(uploaded).toEqual([
			[
				"http://convex-backend:3210/api/storage/upload?token=t",
				"text/markdown",
				"# a",
			],
		]);
		expect(sent.at(-1)).toEqual([
			named(api.files.add),
			{
				workspaceId: WORKSPACE,
				folder: "knowledge",
				name: "a.md",
				storageId: "blob-1",
				contentType: "text/markdown",
			},
		]);
	});

	it("raises the refusal a write comes back with", async () => {
		const { client } = spyClient({
			[named(api.files.uploadUrl)]:
				"https://convex.example.ts.net/api/storage/upload?token=t",
			[named(api.files.add)]: { refused: "FILE_TOO_LARGE" },
		});
		const store = new ConvexKnowledgeStore(WORKSPACE, () => client, {
			download: async () => new Uint8Array(),
			upload: async () => "blob-1" as Id<"_storage">,
		});
		await expect(
			store.write(
				"knowledge",
				"a.md",
				new TextEncoder().encode("x"),
				"text/markdown",
			),
		).rejects.toThrow(/FILE_TOO_LARGE/);
	});
});

describe("the convex panel reader", () => {
	it("reads each pane's tabs, marking the shown and the focused one", async () => {
		const { client, sent } = spyClient({
			[named(api.layouts.get)]: {
				root: "s",
				focused: "p2",
				nodes: [
					{
						kind: "split",
						id: "s",
						direction: "row",
						children: ["p1", "p2"],
						sizes: [50, 50],
					},
					{
						kind: "pane",
						id: "p1",
						active: "chat:c1",
						tabs: [
							{
								id: "chat:c1",
								content: { kind: "chat", chatId: "c1", title: "fix login" },
							},
						],
					},
					{
						kind: "pane",
						id: "p2",
						active: "view:counts",
						tabs: [
							{
								id: "file:knowledge/notes.md",
								content: {
									kind: "file",
									folder: "knowledge",
									name: "notes.md",
								},
							},
							{
								id: "view:counts",
								content: { kind: "view", title: "counts", node: null },
							},
						],
					},
				],
			},
		});
		const reader = new ConvexLayoutStore(WORKSPACE, () => client);
		expect(await reader.tabs()).toEqual([
			{
				id: "chat:c1",
				kind: "chat",
				title: "fix login",
				shown: true,
				focused: false,
			},
			{
				id: "file:knowledge/notes.md",
				kind: "file",
				title: "notes.md",
				shown: false,
				focused: false,
			},
			{
				id: "view:counts",
				kind: "view",
				title: "counts",
				shown: true,
				focused: true,
			},
		]);
		expect(sent).toEqual([
			[named(api.layouts.get), { workspaceId: WORKSPACE }],
		]);
	});

	it("reads no tabs before the panel was ever saved", async () => {
		const { client } = spyClient({});
		const reader = new ConvexLayoutStore(WORKSPACE, () => client);
		expect(await reader.tabs()).toEqual([]);
	});
});

describe("the convex preferences store", () => {
	it("reads what the app stored, leaving the app's own bookkeeping out", async () => {
		const { client } = spyClient({
			[named(api.preferences.get)]: {
				font: "mono",
				themeUses: { borland: 3 },
				input: { lisp: false },
				hidden: ["tests"],
			},
		});
		const store = new ConvexPreferencesStore(() => client);
		expect(await store.read()).toEqual({
			font: "mono",
			metadata: undefined,
			input: { lisp: false },
			hidden: ["tests"],
		});
	});
});
