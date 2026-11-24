import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api.js";
import { clamp } from "../convex/lib/clamp.ts";
import { MAX_MESSAGE_BYTES } from "../convex/limits.ts";
import { signIn, testDeployment } from "./helpers.ts";

const encoder = new TextEncoder();

function size(content: string, kwargs: Record<string, unknown> | undefined) {
	return encoder.encode(JSON.stringify({ content, kwargs })).length;
}

async function stored(kwargs: Record<string, unknown>) {
	const t = testDeployment();
	const alice = await signIn(t, "alice@example.com");
	const chatId = await alice.as.mutation(api.chats.create, {
		workspaceId: alice.workspace,
		title: "work",
	});
	await alice.as.mutation(api.messages.append, {
		chatId,
		messages: [
			{
				id: "h1",
				type: "ai",
				content: "x".repeat(MAX_MESSAGE_BYTES * 2),
				kwargs,
			},
		],
	});
	const [message] = await alice.as.query(api.messages.transcript, { chatId });
	return message;
}

describe("an oversized message", () => {
	it("is stored truncated, under the message ceiling", async () => {
		const message = await stored({
			ui: "y".repeat(MAX_MESSAGE_BYTES * 2),
			meta: { durationMs: 12 },
		});
		expect(message.truncated).toBe(true);
		expect(size(message.content, message.kwargs)).toBeLessThan(
			MAX_MESSAGE_BYTES,
		);
	});

	it("keeps an entry's kind and the ask it is held on when its payload is oversized", async () => {
		const message = await stored({
			value: "y".repeat(MAX_MESSAGE_BYTES * 2),
			kind: "asks",
			holding: "h1",
		});
		expect(message.kwargs).toMatchObject({ kind: "asks", holding: "h1" });
	});
});

describe("clamp", () => {
	it("never splits a multi-byte character", () => {
		const clamped = clamp("é".repeat(MAX_MESSAGE_BYTES), undefined);
		expect(clamped.truncated).toBe(true);
		expect(clamped.content.includes("�")).toBe(false);
	});
});
