import { describe, expect, it } from "vitest";
import { api, components, internal } from "../convex/_generated/api.js";
import { draft, harness, signIn } from "./helpers.ts";

describe("a step's draft", () => {
	it("is claimed once, and only with its token", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const chatId = await alice.as.mutation(api.chats.create, {
			workspaceId: alice.workspace,
		});
		const { streamId, token } = await t.mutation(internal.drafts.open, {
			chatId,
			stepId: "s1",
		});
		expect(
			await t.mutation(internal.drafts.claim, { streamId, token: "guess" }),
		).toBe(false);
		expect(await t.mutation(internal.drafts.claim, { streamId, token })).toBe(
			true,
		);
		expect(await t.mutation(internal.drafts.claim, { streamId, token })).toBe(
			false,
		);
	});

	it("shows what the model wrote until its step is recorded", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const chatId = await alice.as.mutation(api.chats.create, {
			workspaceId: alice.workspace,
		});
		await draft(t, chatId, "s1", "(+ 1 2).");
		expect(await alice.as.query(api.drafts.list, { chatId })).toEqual([
			{ stepId: "s1", text: "(+ 1 2)." },
		]);
		await t.mutation(internal.threads.append, {
			chatId,
			messages: [{ id: "s1", type: "ai", content: "(+ 1 2)" }],
		});
		expect(await alice.as.query(api.drafts.list, { chatId })).toEqual([]);
	});

	it("outlives a turn that died, and is cleared by the next one", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const chatId = await alice.as.mutation(api.chats.create, {
			workspaceId: alice.workspace,
		});
		await t.mutation(internal.threads.start, { chatId });
		await draft(t, chatId, "s1", "half a reply.");
		await t.mutation(internal.threads.settle, {
			chatId,
			failure: "the turn stopped answering",
		});
		expect(await alice.as.query(api.drafts.list, { chatId })).toHaveLength(1);
		await t.mutation(internal.threads.start, { chatId });
		expect(await alice.as.query(api.drafts.list, { chatId })).toEqual([]);
	});

	it("stops taking text once halted", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const chatId = await alice.as.mutation(api.chats.create, {
			workspaceId: alice.workspace,
		});
		const { streamId } = await draft(t, chatId, "s1", "first.");
		await t.mutation(internal.drafts.halt, { streamId });
		await expect(
			t.run(
				async (ctx) =>
					await ctx.runMutation(
						components.persistentTextStreaming.lib.addChunk,
						{ streamId, text: "second.", final: false },
					),
			),
		).rejects.toThrow();
	});
});
