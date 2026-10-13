import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api.js";
import { MAX_TRANSCRIPT } from "../convex/limits.js";
import { harness, signIn } from "./helpers.ts";

describe("a chat's transcript", () => {
	it("holds the newest messages once the chat passes its cap", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const chatId = await alice.as.mutation(api.chats.create, {
			workspaceId: alice.workspace,
			title: "long",
		});
		await alice.as.mutation(api.messages.append, {
			chatId,
			messages: Array.from({ length: MAX_TRANSCRIPT + 5 }, (_, i) => ({
				id: `m${i}`,
				type: "human" as const,
				content: `message ${i}`,
			})),
		});
		const shown = await alice.as.query(api.messages.transcript, { chatId });
		expect(shown).toHaveLength(MAX_TRANSCRIPT);
		expect(shown[0]?.wireId).toBe("m5");
		expect(shown.at(-1)?.wireId).toBe(`m${MAX_TRANSCRIPT + 4}`);
	});
});
