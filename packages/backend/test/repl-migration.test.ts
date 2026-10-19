import type {
	MigrationFunctionReference,
	MigrationResult,
} from "@convex-dev/migrations";
import { IMAGE_FORMAT, type Image } from "@repo/interpreter/image";
import { type Layer, LayerCursor } from "@repo/repl/image-store";
import type { TestConvex } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "../convex/_generated/api.js";
import type { Id } from "../convex/_generated/dataModel.js";
import { chunked } from "../convex/lib/chunks.ts";
import type schema from "../convex/schema.ts";
import { harness, signIn } from "./helpers.ts";

const runAll: MigrationFunctionReference[] = [
	internal.migrations.resetRetiredModels,
	internal.migrations.layerReplImages,
	internal.migrations.pointRepls,
	internal.migrations.pointMessages,
];

function image(globals: string[]): Image {
	return {
		format: IMAGE_FORMAT,
		objects: globals.map((name) => ({ sym: name })),
		globals: globals.map((name, at) => [{ s: name }, { "#": at }]),
		docs: {},
		sources: {},
	};
}

const seeded = { 1: image(["sq"]), 2: image(["sq", "cube"]) };

async function migrate(t: TestConvex<typeof schema>): Promise<void> {
	for (const migration of runAll) {
		let cursor: string | null = null;
		for (;;) {
			const result = (await t.mutation(migration, {
				cursor,
				dryRun: false,
				oneBatchOnly: true,
			})) as MigrationResult;
			if (result.isDone) break;
			cursor = result.continueCursor;
		}
	}
}

async function legacyChat() {
	const t = harness();
	const alice = await signIn(t, "alice@example.com");
	const chatId = await alice.as.mutation(api.chats.create, {
		workspaceId: alice.workspace,
		title: "work",
	});
	const replId = await t.run(async (ctx) => {
		const replId = await ctx.db.insert("repls", {
			workspaceId: alice.workspace,
			call: 2,
			bytes: JSON.stringify(seeded[2]).length,
		});
		await ctx.db.patch(chatId, { replId });
		for (const call of [1, 2] as const) {
			const json = JSON.stringify(seeded[call]);
			const chunks = chunked(json);
			const imageId = await ctx.db.insert("replImages", {
				replId,
				call,
				format: IMAGE_FORMAT,
				bytes: json.length,
				chunks: chunks.length,
			});
			for (const [index, data] of chunks.entries())
				await ctx.db.insert("replImageChunks", { imageId, index, data });
		}
		const messages = [
			{ wireId: "h1", type: "human" as const },
			{
				wireId: "a1",
				type: "ai" as const,
				kwargs: { call: 1, meta: { model: "m" } },
			},
			{ wireId: "t1", type: "tool" as const },
			{ wireId: "h2", type: "human" as const },
			{ wireId: "a2", type: "ai" as const, kwargs: { call: 2 } },
			{ wireId: "t2", type: "tool" as const },
		];
		for (const [seq, message] of messages.entries())
			await ctx.db.insert("messages", {
				chatId,
				workspaceId: alice.workspace,
				seq,
				content: message.wireId,
				...message,
			});
		return replId;
	});
	await migrate(t);
	const layers = await t.run(async (ctx) =>
		(await ctx.db.query("replLayers").collect()).sort(
			(a, b) => a.depth - b.depth,
		),
	);
	const [first, second] = layers.map((layer) => layer._id);
	if (first === undefined || second === undefined)
		throw new Error("the migration made no layers");
	return { t, alice, chatId, replId, layers, first, second };
}

async function messagesOf(t: TestConvex<typeof schema>, chatId: Id<"chats">) {
	return await t.run((ctx) =>
		ctx.db
			.query("messages")
			.withIndex("by_chat_seq", (q) => q.eq("chatId", chatId))
			.collect(),
	);
}

describe("migrating legacy repl images to layers", () => {
	it("empties the legacy tables", async () => {
		const { t } = await legacyChat();
		const left = await t.run(async (ctx) => [
			...(await ctx.db.query("replImages").collect()),
			...(await ctx.db.query("replImageChunks").collect()),
		]);
		expect(left).toEqual([]);
	});

	it("turns each image into a whole layer at its call's depth", async () => {
		const { layers } = await legacyChat();
		expect(
			layers.map(({ depth, whole, legacyCall }) => ({
				depth,
				whole,
				legacyCall,
			})),
		).toEqual([
			{ depth: 1, whole: true, legacyCall: 1 },
			{ depth: 2, whole: true, legacyCall: 2 },
		]);
	});

	it("points the repl at its chat and its last layer", async () => {
		const { t, chatId, replId, second } = await legacyChat();
		const repl = await t.run((ctx) => ctx.db.get(replId));
		expect(repl?.chatId).toBe(chatId);
		expect(repl?.head).toBe(second);
		expect(repl?.call).toBeUndefined();
		expect(repl?.bytes).toBeUndefined();
	});

	it("points each message at the layer of the last call up to it", async () => {
		const { t, chatId, first, second } = await legacyChat();
		const messages = await messagesOf(t, chatId);
		expect(messages.map((m) => [m.wireId, m.layerId ?? null])).toEqual([
			["h1", null],
			["a1", first],
			["t1", first],
			["h2", first],
			["a2", second],
			["t2", second],
		]);
	});

	it("strips the call from kwargs and keeps the rest", async () => {
		const { t, chatId } = await legacyChat();
		const messages = await messagesOf(t, chatId);
		expect(messages.map((m) => [m.wireId, m.kwargs ?? null])).toEqual([
			["h1", null],
			["a1", { meta: { model: "m" } }],
			["t1", null],
			["h2", null],
			["a2", null],
			["t2", null],
		]);
	});

	it("resumes the repl from the last call's image", async () => {
		const { t, replId, second } = await legacyChat();
		const latest = await t.query(internal.repls.latest, { replId });
		expect(latest?.head).toBe(second);
		expect(latest?.depth).toBe(2);
		const layers = (latest?.layers ?? []).map(
			(chunks) => JSON.parse(chunks.join("")) as Layer,
		);
		expect(new LayerCursor().restack(layers)).toEqual(seeded[2]);
	});

	it("forks from the first call's layer at the second turn", async () => {
		const { t, alice, chatId, first } = await legacyChat();
		for (const messageId of ["h2", "a2"]) {
			const forked = await alice.as.mutation(api.chats.fork, {
				chatId,
				messageId,
			});
			const { replId } = await alice.as.query(api.chats.get, {
				chatId: forked,
			});
			if (replId === undefined) throw new Error("the fork has no repl");
			const latest = await t.query(internal.repls.latest, { replId });
			expect(latest?.head).toBe(first);
			expect(latest?.depth).toBe(1);
		}
	});
});
