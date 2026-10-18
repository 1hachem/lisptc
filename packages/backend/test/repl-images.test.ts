import { describe, expect, it } from "vitest";
import { api, internal } from "../convex/_generated/api.js";
import { REPL_IMAGE_CHUNK_CHARS } from "../convex/limits.ts";
import { harness, signIn } from "./helpers.ts";

function chunked(json: string): string[] {
	const chunks: string[] = [];
	for (let at = 0; at < json.length; at += REPL_IMAGE_CHUNK_CHARS)
		chunks.push(json.slice(at, at + REPL_IMAGE_CHUNK_CHARS));
	return chunks;
}

async function chatOf(email: string) {
	const t = harness();
	const user = await signIn(t, email);
	const chatId = await user.as.mutation(api.chats.create, {
		workspaceId: user.workspace,
	});
	const replId = await user.as.mutation(api.repls.open, { chatId });
	return { t, user, chatId, replId };
}

function image(call: number): {
	call: number;
	format: number;
	chunks: string[];
} {
	return { call, format: 1, chunks: chunked(JSON.stringify({ call })) };
}

describe("a chat's repl", () => {
	it("is made once and kept on the chat", async () => {
		const { user, chatId, replId } = await chatOf("alice@example.com");
		expect(await user.as.mutation(api.repls.open, { chatId })).toBe(replId);
		expect((await user.as.query(api.chats.get, { chatId })).replId).toBe(
			replId,
		);
	});

	it("starts empty", async () => {
		const { t, replId } = await chatOf("alice@example.com");
		expect(await t.run((ctx) => ctx.db.get(replId))).toMatchObject({
			call: 0,
			bytes: 0,
		});
	});

	it("keeps its latest call and its size", async () => {
		const { t, replId } = await chatOf("alice@example.com");
		await t.mutation(internal.repls.record, { replId, ...image(1) });
		await t.mutation(internal.repls.record, { replId, ...image(1) });
		const repl = await t.run((ctx) => ctx.db.get(replId));
		expect(repl?.call).toBe(1);
		expect(repl?.bytes).toBeGreaterThan(0);
	});

	it("follows a revert back to the call it kept", async () => {
		const { t, replId } = await chatOf("alice@example.com");
		for (const call of [1, 2, 3])
			await t.mutation(internal.repls.record, { replId, ...image(call) });
		await t.mutation(internal.repls.dropAfter, { replId, call: 1 });
		expect((await t.run((ctx) => ctx.db.get(replId)))?.call).toBe(1);
	});
});

describe("repl checkpoints", () => {
	it("keeps one per call and hands back the latest", async () => {
		const { t, replId } = await chatOf("alice@example.com");
		for (const call of [1, 2, 3])
			await t.mutation(internal.repls.record, { replId, ...image(call) });
		const latest = await t.query(internal.repls.latest, { replId });
		expect(latest?.call).toBe(3);
		expect(JSON.parse(latest?.chunks.join("") ?? "")).toEqual({ call: 3 });
		const second = await t.query(internal.repls.at, { replId, call: 2 });
		expect(JSON.parse(second?.chunks.join("") ?? "")).toEqual({ call: 2 });
	});

	it("replaces a call recorded twice", async () => {
		const { t, replId } = await chatOf("alice@example.com");
		await t.mutation(internal.repls.record, { replId, ...image(1) });
		await t.mutation(internal.repls.record, { replId, ...image(1) });
		const rows = await t.run((ctx) => ctx.db.query("replImages").collect());
		expect(rows).toHaveLength(1);
	});

	it("drops every call after the one reverted to", async () => {
		const { t, replId } = await chatOf("alice@example.com");
		for (const call of [1, 2, 3])
			await t.mutation(internal.repls.record, { replId, ...image(call) });
		await t.mutation(internal.repls.dropAfter, { replId, call: 1 });
		expect((await t.query(internal.repls.latest, { replId }))?.call).toBe(1);
		expect(await t.query(internal.repls.at, { replId, call: 3 })).toBeNull();
	});

	it("splits a large image across rows and joins it back", async () => {
		const { t, replId } = await chatOf("alice@example.com");
		const json = JSON.stringify({
			text: "x".repeat(REPL_IMAGE_CHUNK_CHARS * 2),
		});
		await t.mutation(internal.repls.record, {
			replId,
			call: 1,
			format: 1,
			chunks: chunked(json),
		});
		const latest = await t.query(internal.repls.latest, { replId });
		expect(latest?.chunks).toHaveLength(3);
		expect(latest?.chunks.join("")).toBe(json);
	});
});
