import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../convex/_generated/api.js";
import type { Id } from "../convex/_generated/dataModel.js";
import { harness, type Signed, signIn } from "./helpers.ts";

afterEach(() => {
	vi.useRealTimers();
});

async function conversation() {
	const t = harness();
	const alice = await signIn(t, "alice@example.com");
	const chatId = await alice.as.mutation(api.chats.create, {
		workspaceId: alice.workspace,
		title: "work",
	});
	const replId = await alice.as.mutation(api.repls.open, { chatId });
	await alice.as.mutation(api.messages.append, {
		chatId,
		messages: [
			{ id: "h1", type: "human", content: "define sq" },
			{ id: "a1", type: "ai", content: "(defun sq (x) (* x x))" },
			{ id: "t1", type: "tool", content: "sq" },
		],
	});
	const first = await t.mutation(internal.repls.record, {
		replId,
		origin: "a1",
		whole: true,
		chunks: [JSON.stringify({ layer: 1 })],
	});
	const second = await t.mutation(internal.repls.record, {
		replId,
		over: first,
		origin: "a2",
		whole: false,
		chunks: [JSON.stringify({ layer: 2 })],
	});
	await alice.as.mutation(api.messages.append, {
		chatId,
		messages: [
			{ id: "h2", type: "human", content: "define cube" },
			{ id: "a2", type: "ai", content: "(defun cube (x) (* x x x))" },
			{ id: "t2", type: "tool", content: "cube" },
		],
	});
	return { t, alice, chatId, replId, first, second };
}

async function forkedRepl(
	alice: Signed,
	chatId: Id<"chats">,
	messageId: string,
): Promise<{ forked: Id<"chats">; replId: Id<"repls"> }> {
	const forked = await alice.as.mutation(api.chats.fork, {
		chatId,
		messageId,
	});
	const { replId } = await alice.as.query(api.chats.get, { chatId: forked });
	if (replId === undefined) throw new Error("the fork has no repl");
	return { forked, replId };
}

describe("a message's layer", () => {
	it("is back-filled when the layer is recorded after the message", async () => {
		const { t, chatId, first } = await conversation();
		const layers = await t.run(async (ctx) =>
			(
				await ctx.db
					.query("messages")
					.withIndex("by_chat_seq", (q) => q.eq("chatId", chatId))
					.collect()
			).map((m) => [m.wireId, m.layerId ?? null]),
		);
		expect(layers.slice(0, 3)).toEqual([
			["h1", null],
			["a1", first],
			["t1", first],
		]);
	});

	it("is set on append when the layer was recorded first", async () => {
		const { t, chatId, first, second } = await conversation();
		const layers = await t.run(async (ctx) =>
			(
				await ctx.db
					.query("messages")
					.withIndex("by_chat_seq", (q) => q.eq("chatId", chatId))
					.collect()
			).map((m) => [m.wireId, m.layerId ?? null]),
		);
		expect(layers.slice(3)).toEqual([
			["h2", first],
			["a2", second],
			["t2", second],
		]);
	});
});

describe("forking a chat at a message", () => {
	it("copies the conversation up to that message into a new chat", async () => {
		const { alice, chatId } = await conversation();
		const forked = await alice.as.mutation(api.chats.fork, {
			chatId,
			messageId: "h2",
		});
		const kept = await alice.as.query(api.messages.transcript, {
			chatId: forked,
		});
		expect(kept.map((m) => m.wireId)).toEqual(["h1", "a1", "t1", "h2"]);
		expect(
			(await alice.as.query(api.chats.get, { chatId: forked })).title,
		).toBe("work (fork)");
	});

	it("carries the chat's rendered views into the fork", async () => {
		const { alice, chatId } = await conversation();
		const node = { tag: "text", props: { text: "hi" }, children: [] };
		await alice.as.mutation(api.views.put, { chatId, viewId: "v1", node });
		const forked = await alice.as.mutation(api.chats.fork, {
			chatId,
			messageId: "h2",
		});
		expect(
			await alice.as.query(api.views.get, { chatId: forked, viewId: "v1" }),
		).toEqual({ node, rev: 1 });
	});

	it("leaves the original chat as it was", async () => {
		const { t, alice, chatId, replId, second } = await conversation();
		await alice.as.mutation(api.chats.fork, { chatId, messageId: "t1" });
		const original = await alice.as.query(api.messages.transcript, { chatId });
		expect(original).toHaveLength(6);
		expect((await t.query(internal.repls.latest, { replId }))?.head).toBe(
			second,
		);
	});

	it("starts the fork's repl from the last layer up to a human message", async () => {
		const { t, alice, chatId, replId: original, first } = await conversation();
		const { replId } = await forkedRepl(alice, chatId, "h2");
		expect(replId).not.toBe(original);
		const latest = await t.query(internal.repls.latest, { replId });
		expect(latest?.head).toBe(first);
		expect(latest?.depth).toBe(1);
		expect(latest?.layers.map((chunks) => JSON.parse(chunks.join("")))).toEqual(
			[{ layer: 1 }],
		);
	});

	it("starts the fork's repl from before the code an ai message ran", async () => {
		const { t, alice, chatId, first } = await conversation();
		const { replId } = await forkedRepl(alice, chatId, "a2");
		expect((await t.query(internal.repls.latest, { replId }))?.head).toBe(
			first,
		);
	});

	it("shares the layer with the original rather than copying it", async () => {
		const { t, alice, chatId, second } = await conversation();
		const before = await t.run((ctx) => ctx.db.query("replLayers").collect());
		const { replId } = await forkedRepl(alice, chatId, "t2");
		const repl = await t.run((ctx) => ctx.db.get(replId));
		expect(repl?.head).toBe(second);
		const after = await t.run((ctx) => ctx.db.query("replLayers").collect());
		expect(after).toHaveLength(before.length);
	});

	it("resumes the fork from the shared layer's whole run", async () => {
		const { t, alice, chatId, second } = await conversation();
		const { replId } = await forkedRepl(alice, chatId, "t2");
		const latest = await t.query(internal.repls.latest, { replId });
		expect(latest?.head).toBe(second);
		expect(latest?.depth).toBe(2);
		expect(latest?.layers.map((chunks) => JSON.parse(chunks.join("")))).toEqual(
			[{ layer: 1 }, { layer: 2 }],
		);
	});

	it("records the fork's own layers over the shared one", async () => {
		const {
			t,
			alice,
			chatId,
			replId: original,
			first,
			second,
		} = await conversation();
		const { replId } = await forkedRepl(alice, chatId, "h2");
		const own = await t.mutation(internal.repls.record, {
			replId,
			over: first,
			origin: "a3",
			whole: false,
			chunks: [JSON.stringify({ layer: 3 })],
		});
		expect((await t.query(internal.repls.latest, { replId }))?.head).toBe(own);
		expect(
			(await t.query(internal.repls.latest, { replId: original }))?.head,
		).toBe(second);
	});

	it("starts a fresh repl when no layer came before the message", async () => {
		const { alice, chatId } = await conversation();
		for (const messageId of ["h1", "a1"]) {
			const forked = await alice.as.mutation(api.chats.fork, {
				chatId,
				messageId,
			});
			expect(
				(await alice.as.query(api.chats.get, { chatId: forked })).replId,
			).toBeUndefined();
		}
	});

	it("keeps the layers the fork stands on when the original is removed", async () => {
		const { t, alice, chatId, first } = await conversation();
		const { forked, replId } = await forkedRepl(alice, chatId, "h2");

		vi.useFakeTimers();
		await alice.as.mutation(api.chats.remove, { chatId });
		await t.finishAllScheduledFunctions(vi.runAllTimers);

		const left = await t.run((ctx) => ctx.db.query("replLayers").collect());
		expect(left.map((layer) => layer._id)).toEqual([first]);
		const latest = await t.query(internal.repls.latest, { replId });
		expect(latest?.depth).toBe(1);
		expect(JSON.parse(latest?.layers[0].join("") ?? "")).toEqual({ layer: 1 });

		await alice.as.mutation(api.chats.remove, { chatId: forked });
		await t.finishAllScheduledFunctions(vi.runAllTimers);
		const gone = await t.run(async (ctx) => [
			...(await ctx.db.query("replLayers").collect()),
			...(await ctx.db.query("replLayerChunks").collect()),
		]);
		expect(gone).toEqual([]);
	});

	it("keeps a fork's layers when the original and a sibling fork are removed", async () => {
		const { t, alice, chatId, second } = await conversation();
		await alice.as.mutation(api.messages.append, {
			chatId,
			messages: [{ id: "f2", type: "ai", content: "cube is defined" }],
		});
		const { forked: sibling } = await forkedRepl(alice, chatId, "f2");
		const { forked, replId } = await forkedRepl(alice, chatId, "f2");
		const ownedBefore = await t.query(internal.repls.latest, { replId });
		expect(ownedBefore?.head).toBe(second);

		vi.useFakeTimers();
		await alice.as.mutation(api.chats.remove, { chatId });
		await alice.as.mutation(api.chats.remove, { chatId: sibling });
		await t.finishAllScheduledFunctions(vi.runAllTimers);

		const latest = await t.query(internal.repls.latest, { replId });
		expect(latest?.head).toBe(second);
		expect(latest?.layers.map((chunks) => JSON.parse(chunks.join("")))).toEqual(
			[{ layer: 1 }, { layer: 2 }],
		);

		await alice.as.mutation(api.chats.remove, { chatId: forked });
		await t.finishAllScheduledFunctions(vi.runAllTimers);
		const gone = await t.run(async (ctx) => [
			...(await ctx.db.query("replLayers").collect()),
			...(await ctx.db.query("replLayerChunks").collect()),
		]);
		expect(gone).toEqual([]);
	});

	it("leaves no layer behind once every chat over it is removed after a fork at an ai message", async () => {
		const { t, alice, chatId } = await conversation();
		const { forked, replId } = await forkedRepl(alice, chatId, "a2");
		await t.mutation(internal.repls.record, {
			replId,
			over: (await t.query(internal.repls.latest, { replId }))?.head,
			origin: "a3",
			whole: false,
			chunks: [JSON.stringify({ layer: 3 })],
		});

		vi.useFakeTimers();
		await alice.as.mutation(api.chats.remove, { chatId });
		await t.finishAllScheduledFunctions(vi.runAllTimers);
		await alice.as.mutation(api.chats.remove, { chatId: forked });
		await t.finishAllScheduledFunctions(vi.runAllTimers);

		const gone = await t.run(async (ctx) => [
			...(await ctx.db.query("replLayers").collect()),
			...(await ctx.db.query("replLayerChunks").collect()),
		]);
		expect(gone).toEqual([]);
	});

	it("refuses a message that is not in the chat", async () => {
		const { alice, chatId } = await conversation();
		await expect(
			alice.as.mutation(api.chats.fork, { chatId, messageId: "nope" }),
		).rejects.toThrow();
	});
});
