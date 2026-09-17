import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../convex/_generated/api.js";
import { harness, signIn } from "./helpers.ts";

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

describe("removing a chat", () => {
	it("takes its messages with it", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const chatId = await alice.as.mutation(api.chats.create, {
			workspaceId: alice.workspace,
		});
		await alice.as.mutation(api.messages.append, {
			chatId,
			messages: [{ type: "human", content: "hello" }],
		});

		await alice.as.mutation(api.chats.remove, { chatId });
		await t.finishAllScheduledFunctions(vi.runAllTimers);

		const left = await t.run(
			async (ctx) => await ctx.db.query("messages").collect(),
		);
		expect(left).toEqual([]);
	});

	it("drops it from the list at once", async () => {
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

		await alice.as.mutation(api.chats.remove, { chatId: gone });

		const listed = await alice.as.query(api.chats.list, {
			workspaceId: alice.workspace,
		});
		expect(listed.map((c) => c._id)).toEqual([kept]);
	});

	it("refuses a chat owned by someone else", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const bob = await signIn(t, "bob@example.com");
		const chatId = await bob.as.mutation(api.chats.create, {
			workspaceId: bob.workspace,
		});
		await expect(
			alice.as.mutation(api.chats.remove, { chatId }),
		).rejects.toThrow();
	});
});

describe("removing a workspace", () => {
	it("takes its chats and their messages with it", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const doomed = await alice.as.mutation(api.workspaces.create, {
			name: "doomed",
		});
		const chatId = await alice.as.mutation(api.chats.create, {
			workspaceId: doomed,
		});
		await alice.as.mutation(api.messages.append, {
			chatId,
			messages: [{ type: "human", content: "hello" }],
		});

		await alice.as.mutation(api.workspaces.remove, { workspaceId: doomed });
		await t.finishAllScheduledFunctions(vi.runAllTimers);

		const { chats, messages } = await t.run(async (ctx) => ({
			chats: await ctx.db.query("chats").collect(),
			messages: await ctx.db.query("messages").collect(),
		}));
		expect(chats).toEqual([]);
		expect(messages).toEqual([]);
	});

	it("leaves the other workspaces alone", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const doomed = await alice.as.mutation(api.workspaces.create, {
			name: "doomed",
		});

		const landing = await alice.as.mutation(api.workspaces.remove, {
			workspaceId: doomed,
		});

		expect(landing).toEqual(alice.workspace);
		const listed = await alice.as.query(api.workspaces.list, {});
		expect(listed.map((w) => w._id)).toEqual([alice.workspace]);
	});

	it("replaces the last one rather than leaving none", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");

		const landing = await alice.as.mutation(api.workspaces.remove, {
			workspaceId: alice.workspace,
		});

		expect(landing).not.toEqual(alice.workspace);
		const listed = await alice.as.query(api.workspaces.list, {});
		expect(listed.map((w) => w._id)).toEqual([landing]);
	});

	it("refuses a workspace owned by someone else", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const bob = await signIn(t, "bob@example.com");
		await expect(
			alice.as.mutation(api.workspaces.remove, { workspaceId: bob.workspace }),
		).rejects.toThrow();
	});
});
