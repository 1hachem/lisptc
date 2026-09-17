import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api.js";
import { harness, signIn } from "./helpers.ts";

describe("workspace access", () => {
	it("lists only the workspaces a user owns", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		await signIn(t, "bob@example.com");
		const listed = await alice.as.query(api.workspaces.list, {});
		expect(listed.map((w) => w._id)).toEqual([alice.workspace]);
	});

	it("refuses a workspace owned by someone else", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const bob = await signIn(t, "bob@example.com");
		await expect(
			alice.as.query(api.workspaces.get, { workspaceId: bob.workspace }),
		).rejects.toThrow();
	});

	it("refuses an unauthenticated caller", async () => {
		const t = harness();
		await signIn(t, "alice@example.com");
		await expect(t.query(api.workspaces.list, {})).rejects.toThrow();
	});
});

describe("chat access", () => {
	it("refuses reading another user's chat", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const bob = await signIn(t, "bob@example.com");
		const chatId = await bob.as.mutation(api.chats.create, {
			workspaceId: bob.workspace,
		});
		await expect(alice.as.query(api.chats.get, { chatId })).rejects.toThrow();
		await expect(
			alice.as.query(api.messages.transcript, { chatId }),
		).rejects.toThrow();
	});

	it("refuses appending to another user's chat", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const bob = await signIn(t, "bob@example.com");
		const chatId = await bob.as.mutation(api.chats.create, {
			workspaceId: bob.workspace,
		});
		await expect(
			alice.as.mutation(api.messages.append, {
				chatId,
				messages: [{ type: "human", content: "hello" }],
			}),
		).rejects.toThrow();
	});

	it("hides an archived chat from the list", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const kept = await alice.as.mutation(api.chats.create, {
			workspaceId: alice.workspace,
			title: "kept",
		});
		const gone = await alice.as.mutation(api.chats.create, {
			workspaceId: alice.workspace,
			title: "gone",
		});
		await alice.as.mutation(api.chats.archive, { chatId: gone });
		const listed = await alice.as.query(api.chats.list, {
			workspaceId: alice.workspace,
		});
		expect(listed.map((c) => c._id)).toEqual([kept]);
	});
});

describe("messages", () => {
	it("numbers appended messages in order", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const chatId = await alice.as.mutation(api.chats.create, {
			workspaceId: alice.workspace,
		});
		await alice.as.mutation(api.messages.append, {
			chatId,
			messages: [{ type: "human", content: "one" }],
		});
		await alice.as.mutation(api.messages.append, {
			chatId,
			messages: [
				{ type: "ai", content: "two" },
				{ type: "tool", content: "three", kwargs: { ui: { kind: "text" } } },
			],
		});
		const transcript = await alice.as.query(api.messages.transcript, {
			chatId,
		});
		expect(transcript.map((m) => [m.seq, m.type, m.content])).toEqual([
			[0, "human", "one"],
			[1, "ai", "two"],
			[2, "tool", "three"],
		]);
		expect(transcript[2].kwargs).toEqual({ ui: { kind: "text" } });
	});

	it("stamps the chat with its last activity", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const chatId = await alice.as.mutation(api.chats.create, {
			workspaceId: alice.workspace,
		});
		await alice.as.mutation(api.messages.append, {
			chatId,
			messages: [{ type: "human", content: "one" }],
		});
		const chat = await alice.as.query(api.chats.get, { chatId });
		expect(chat.lastMessageAt).toBeTypeOf("number");
	});
});
