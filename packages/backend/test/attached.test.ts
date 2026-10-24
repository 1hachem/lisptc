import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api.js";
import { harness, signIn } from "./helpers.ts";

async function chat() {
	const t = harness();
	const alice = await signIn(t, "alice@example.com");
	const chatId = await alice.as.mutation(api.chats.create, {
		workspaceId: alice.workspace,
		title: "work",
	});
	return { alice, chatId };
}

describe("the files a message attached", () => {
	it("stores well formed attachments with the message", async () => {
		const { alice, chatId } = await chat();
		const attachments = [{ folder: "attachments", name: "spec.pdf" }];
		await alice.as.mutation(api.messages.append, {
			chatId,
			messages: [
				{ id: "h1", type: "human", content: "see", kwargs: { attachments } },
			],
		});
		const [stored] = await alice.as.query(api.messages.transcript, { chatId });
		expect(stored.kwargs).toEqual({ attachments });
	});

	it.each([
		["an unknown folder", [{ folder: "elsewhere", name: "x" }]],
		["an empty name", [{ folder: "knowledge", name: "" }]],
		["a path in place of a list", "attachments/spec.pdf"],
	])("refuses a message whose attachments hold %s", async (_, attachments) => {
		const { alice, chatId } = await chat();
		await expect(
			alice.as.mutation(api.messages.append, {
				chatId,
				messages: [
					{ id: "h1", type: "human", content: "", kwargs: { attachments } },
				],
			}),
		).rejects.toThrow(/MALFORMED_ATTACHMENTS/);
		expect(await alice.as.query(api.messages.transcript, { chatId })).toEqual(
			[],
		);
	});

	it("refuses attachments annotated onto a stored message", async () => {
		const { alice, chatId } = await chat();
		await alice.as.mutation(api.messages.append, {
			chatId,
			messages: [{ id: "t1", type: "tool", content: "" }],
		});
		await expect(
			alice.as.mutation(api.messages.annotate, {
				chatId,
				id: "t1",
				kwargs: { attachments: [{ folder: "bin", name: "x" }] },
			}),
		).rejects.toThrow(/MALFORMED_ATTACHMENTS/);
	});
});
