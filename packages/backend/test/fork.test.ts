import { describe, expect, it } from "vitest";
import { api, internal } from "../convex/_generated/api.js";
import { harness, signIn } from "./helpers.ts";

async function conversation() {
	const t = harness();
	const alice = await signIn(t, "alice@example.com");
	const chatId = await alice.as.mutation(api.chats.create, {
		workspaceId: alice.workspace,
		title: "work",
	});
	await alice.as.mutation(api.messages.append, {
		chatId,
		messages: [
			{ id: "h1", type: "human", content: "define sq" },
			{
				id: "a1",
				type: "ai",
				content: "(defun sq (x) (* x x))",
				kwargs: { call: 1 },
			},
			{ id: "t1", type: "tool", content: "sq", kwargs: { call: 1 } },
			{ id: "h2", type: "human", content: "define cube" },
			{
				id: "a2",
				type: "ai",
				content: "(defun cube (x) (* x x x))",
				kwargs: { call: 2 },
			},
		],
	});
	const replId = await alice.as.mutation(api.repls.open, { chatId });
	for (const call of [1, 2])
		await t.mutation(internal.repls.record, {
			replId,
			call,
			format: 1,
			chunks: [JSON.stringify({ call })],
		});
	return { t, alice, chatId, replId };
}

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

	it("leaves the original chat as it was", async () => {
		const { t, alice, chatId, replId } = await conversation();
		await alice.as.mutation(api.chats.fork, { chatId, messageId: "a1" });
		const original = await alice.as.query(api.messages.transcript, { chatId });
		expect(original).toHaveLength(5);
		expect((await t.query(internal.repls.latest, { replId }))?.call).toBe(2);
	});

	it("starts the fork's repl from the last call made up to that message", async () => {
		const { t, alice, chatId, replId: originalRepl } = await conversation();
		const forked = await alice.as.mutation(api.chats.fork, {
			chatId,
			messageId: "h2",
		});
		const { replId } = await alice.as.query(api.chats.get, { chatId: forked });
		if (replId === undefined) throw new Error("the fork has no repl");
		expect(replId).not.toBe(originalRepl);
		const latest = await t.query(internal.repls.latest, { replId });
		expect(latest?.call).toBe(1);
		expect(JSON.parse(latest?.chunks.join("") ?? "")).toEqual({ call: 1 });
	});

	it("starts a fresh repl when no call came before the message", async () => {
		const { alice, chatId } = await conversation();
		const forked = await alice.as.mutation(api.chats.fork, {
			chatId,
			messageId: "h1",
		});
		expect(
			(await alice.as.query(api.chats.get, { chatId: forked })).replId,
		).toBeUndefined();
	});

	it("refuses a message that is not in the chat", async () => {
		const { alice, chatId } = await conversation();
		await expect(
			alice.as.mutation(api.chats.fork, { chatId, messageId: "nope" }),
		).rejects.toThrow();
	});
});
