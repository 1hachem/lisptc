import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api.js";
import { REPL_IMAGE_CHUNK_CHARS } from "../convex/limits.ts";
import { chunked } from "../src/image-store.ts";
import { harness, signIn } from "./helpers.ts";

async function chatOf(email: string) {
	const t = harness();
	const user = await signIn(t, email);
	const chatId = await user.as.mutation(api.chats.create, {
		workspaceId: user.workspace,
	});
	return { t, user, chatId };
}

function image(call: number): {
	call: number;
	format: number;
	chunks: string[];
} {
	return { call, format: 1, chunks: chunked(JSON.stringify({ call })) };
}

describe("repl checkpoints", () => {
	it("keeps one per call and hands back the latest", async () => {
		const { user, chatId } = await chatOf("alice@example.com");
		for (const call of [1, 2, 3])
			await user.as.mutation(api.replImages.record, { chatId, ...image(call) });
		const latest = await user.as.query(api.replImages.latest, { chatId });
		expect(latest?.call).toBe(3);
		expect(JSON.parse(latest?.chunks.join("") ?? "")).toEqual({ call: 3 });
		const second = await user.as.query(api.replImages.at, { chatId, call: 2 });
		expect(JSON.parse(second?.chunks.join("") ?? "")).toEqual({ call: 2 });
	});

	it("replaces a call recorded twice", async () => {
		const { t, user, chatId } = await chatOf("alice@example.com");
		await user.as.mutation(api.replImages.record, { chatId, ...image(1) });
		await user.as.mutation(api.replImages.record, { chatId, ...image(1) });
		const rows = await t.run((ctx) => ctx.db.query("replImages").collect());
		expect(rows).toHaveLength(1);
	});

	it("drops every call after the one reverted to", async () => {
		const { user, chatId } = await chatOf("alice@example.com");
		for (const call of [1, 2, 3])
			await user.as.mutation(api.replImages.record, { chatId, ...image(call) });
		await user.as.mutation(api.replImages.dropAfter, { chatId, call: 1 });
		expect((await user.as.query(api.replImages.latest, { chatId }))?.call).toBe(
			1,
		);
		expect(
			await user.as.query(api.replImages.at, { chatId, call: 3 }),
		).toBeNull();
	});

	it("splits a large image across rows and joins it back", async () => {
		const { user, chatId } = await chatOf("alice@example.com");
		const json = JSON.stringify({
			text: "x".repeat(REPL_IMAGE_CHUNK_CHARS * 2),
		});
		await user.as.mutation(api.replImages.record, {
			chatId,
			call: 1,
			format: 1,
			chunks: chunked(json),
		});
		const latest = await user.as.query(api.replImages.latest, { chatId });
		expect(latest?.chunks).toHaveLength(3);
		expect(latest?.chunks.join("")).toBe(json);
	});
});
