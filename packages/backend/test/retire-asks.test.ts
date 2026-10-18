import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api.js";
import { harness, signIn } from "./helpers.ts";

const ask = (id: string) => ({
	id,
	title: "echo",
	prompt: "allow it?",
	choices: [],
});

async function waitingChat() {
	const t = harness();
	const alice = await signIn(t, "alice@example.com");
	const chatId = await alice.as.mutation(api.chats.create, {
		workspaceId: alice.workspace,
	});
	await alice.as.mutation(api.messages.append, {
		chatId,
		messages: [
			{ id: "h1", type: "human", content: "echo something" },
			{
				id: "t1",
				type: "tool",
				content: "held",
				kwargs: {
					asks: {
						open: [ask("r1"), ask("r2")],
						answered: { r1: { accepted: true, label: "Allowed once" } },
					},
				},
			},
		],
	});
	await alice.as.mutation(api.chats.start, { chatId });
	await alice.as.mutation(api.chats.settle, { chatId });
	return { alice, chatId };
}

describe("retiring the asks a restart left behind", () => {
	it("closes every unanswered ask and keeps the answered ones", async () => {
		const { alice, chatId } = await waitingChat();
		await alice.as.mutation(api.messages.retireAsks, { chatId });
		const [, held] = await alice.as.query(api.messages.transcript, { chatId });
		expect(held?.kwargs?.asks.answered).toEqual({
			r1: { accepted: true, label: "Allowed once" },
			r2: { accepted: false, label: "Ended when the REPL restarted" },
		});
		expect(held?.kwargs?.asks.open).toHaveLength(2);
	});

	it("stops the chat waiting on the user", async () => {
		const { alice, chatId } = await waitingChat();
		expect((await alice.as.query(api.chats.get, { chatId })).status).toBe(
			"waiting",
		);
		await alice.as.mutation(api.messages.retireAsks, { chatId });
		expect(
			(await alice.as.query(api.chats.get, { chatId })).status,
		).toBeUndefined();
	});

	it("tells the model what was dropped, after the step that held", async () => {
		const { alice, chatId } = await waitingChat();
		await alice.as.mutation(api.messages.retireAsks, {
			chatId,
			note: "run (echo 1) again",
		});
		const last = (await alice.as.query(api.messages.transcript, { chatId })).at(
			-1,
		);
		expect(last).toMatchObject({
			type: "system",
			content: "run (echo 1) again",
			kwargs: { source: "repl" },
		});
	});

	it("adds no message when nothing was dropped", async () => {
		const { alice, chatId } = await waitingChat();
		await alice.as.mutation(api.messages.retireAsks, { chatId });
		expect(
			await alice.as.query(api.messages.transcript, { chatId }),
		).toHaveLength(2);
	});
});
