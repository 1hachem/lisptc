import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../convex/_generated/api.js";
import { chunked } from "../convex/lib/chunks.ts";
import { harness, signIn } from "./helpers.ts";

async function chatOf(email: string) {
	const t = harness();
	const user = await signIn(t, email);
	const chatId = await user.as.mutation(api.chats.create, {
		workspaceId: user.workspace,
	});
	const replId = await user.as.mutation(api.repls.open, { chatId });
	return { t, user, chatId, replId };
}

afterEach(() => {
	vi.useRealTimers();
});

describe("a chat's repl lifecycle", () => {
	it("records when it opened and is marked open", async () => {
		vi.useFakeTimers({ now: 1_000 });
		const { t, replId } = await chatOf("alice@example.com");
		expect(await t.run((ctx) => ctx.db.get(replId))).toMatchObject({
			state: "open",
			openedAt: 1_000,
			lastActiveAt: 1_000,
		});
	});

	it("keeps when it last recorded a layer", async () => {
		vi.useFakeTimers({ now: 1_000 });
		const { t, replId } = await chatOf("alice@example.com");
		vi.setSystemTime(2_000);
		const head = await t.mutation(internal.repls.record, {
			replId,
			whole: true,
			chunks: chunked(JSON.stringify({ n: 1 })),
		});
		const repl = await t.run((ctx) => ctx.db.get(replId));
		expect(repl).toMatchObject({ head, lastActiveAt: 2_000 });
	});

	it("records when it closed and whether it saved", async () => {
		const { t, chatId, replId } = await chatOf("alice@example.com");
		vi.useFakeTimers({ now: 5_000 });
		await t.mutation(internal.repls.closeChat, { chatId, saved: false });
		expect(await t.run((ctx) => ctx.db.get(replId))).toMatchObject({
			state: "closed",
			closedAt: 5_000,
			closedSaved: false,
		});
	});

	it("leaves a system note at the end of the chat when it closes", async () => {
		const { t, user, chatId } = await chatOf("alice@example.com");
		await user.as.mutation(api.messages.append, {
			chatId,
			messages: [{ type: "human", content: "hello" }],
		});
		await t.mutation(internal.repls.closeChat, { chatId, saved: true });
		const last = (await user.as.query(api.messages.transcript, { chatId })).at(
			-1,
		);
		expect(last).toMatchObject({
			type: "system",
			kwargs: { source: "repl" },
		});
		expect(last?.content).toContain("saved and closed");
	});

	it("closes nothing for a chat that was removed", async () => {
		const { t, user, chatId } = await chatOf("alice@example.com");
		await user.as.mutation(api.chats.remove, { chatId });
		await t.mutation(internal.repls.closeChat, { chatId, saved: true });
		expect(await t.run((ctx) => ctx.db.query("messages").collect())).toEqual(
			[],
		);
	});
});
