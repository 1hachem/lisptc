import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../convex/_generated/api.js";
import { REPL_IMAGE_CHUNK_CHARS } from "../convex/limits.ts";
import { chunked } from "../src/image-store.ts";
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

function image(call: number): {
	call: number;
	format: number;
	chunks: string[];
} {
	return { call, format: 1, chunks: chunked(JSON.stringify({ call })) };
}

afterEach(() => {
	vi.useRealTimers();
});

describe("a chat's repl", () => {
	it("is made once and kept on the chat", async () => {
		const { user, chatId, replId } = await chatOf("alice@example.com");
		expect(await user.as.mutation(api.repls.open, { chatId })).toBe(replId);
		expect((await user.as.query(api.chats.get, { chatId })).replId).toBe(
			replId,
		);
	});

	it("records when it opened and is marked open", async () => {
		vi.useFakeTimers({ now: 1_000 });
		const { t, replId } = await chatOf("alice@example.com");
		expect(await t.run((ctx) => ctx.db.get(replId))).toMatchObject({
			state: "open",
			call: 0,
			bytes: 0,
			openedAt: 1_000,
			lastActiveAt: 1_000,
		});
	});

	it("keeps its latest call and when it last ran", async () => {
		vi.useFakeTimers({ now: 1_000 });
		const { t, replId } = await chatOf("alice@example.com");
		vi.setSystemTime(2_000);
		await t.mutation(internal.repls.record, { replId, ...image(1) });
		vi.setSystemTime(3_000);
		await t.mutation(internal.repls.record, { replId, ...image(1) });
		const repl = await t.run((ctx) => ctx.db.get(replId));
		expect(repl).toMatchObject({ call: 1, lastActiveAt: 2_000 });
		expect(repl?.bytes).toBeGreaterThan(0);
	});

	it("follows a revert back to the call it kept", async () => {
		const { t, replId } = await chatOf("alice@example.com");
		for (const call of [1, 2, 3])
			await t.mutation(internal.repls.record, { replId, ...image(call) });
		await t.mutation(internal.repls.dropAfter, { replId, call: 1 });
		expect((await t.run((ctx) => ctx.db.get(replId)))?.call).toBe(1);
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
