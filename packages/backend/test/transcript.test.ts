import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api.js";
import { harness, signIn } from "./helpers.ts";

describe("a chat's transcript", () => {
	it("holds every message of a long chat, in chat order", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const chatId = await alice.as.mutation(api.chats.create, {
			workspaceId: alice.workspace,
			title: "long",
		});
		const count = 450;
		await alice.as.mutation(api.messages.append, {
			chatId,
			messages: Array.from({ length: count }, (_, i) => ({
				id: `m${i}`,
				type: "human" as const,
				content: `message ${i}`,
			})),
		});
		const shown = await alice.as.query(api.messages.transcript, { chatId });
		expect(shown.map((row) => row.wireId)).toEqual(
			Array.from({ length: count }, (_, i) => `m${i}`),
		);
	});
});
