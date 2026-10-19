import type { Image } from "@repo/interpreter/image";
import type { TestConvex } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "../convex/_generated/api.js";
import type { Id } from "../convex/_generated/dataModel.js";
import { chunked } from "../convex/lib/chunks.ts";
import {
	MAX_REPL_LAYER_BYTES,
	REPL_LAYER_CHUNK_CHARS,
} from "../convex/limits.ts";
import type schema from "../convex/schema.ts";
import { ConvexImageStore } from "../src/image-store.ts";
import type { ServerClient } from "../src/server-client.ts";
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

function layer(n: number, over?: Id<"replLayers">) {
	return {
		over,
		whole: over === undefined,
		chunks: chunked(JSON.stringify({ n })),
	};
}

function serverOf(t: TestConvex<typeof schema>): ServerClient {
	const call = t as unknown as {
		query(query: unknown, args: unknown): Promise<never>;
		mutation(mutation: unknown, args: unknown): Promise<never>;
	};
	return {
		query: (query, args) => call.query(query, args),
		mutation: (mutation, args) => call.mutation(mutation, args),
	};
}

function image(globals: string[]): Image {
	return {
		format: 2,
		objects: globals.map((name) => ({ sym: name })),
		globals: globals.map((name, at) => [{ s: name }, { "#": at }]),
		docs: {},
		sources: {},
	};
}

describe("a chat's repl", () => {
	it("is made once and kept on the chat", async () => {
		const { user, chatId, replId } = await chatOf("alice@example.com");
		expect(await user.as.mutation(api.repls.open, { chatId })).toBe(replId);
		expect((await user.as.query(api.chats.get, { chatId })).replId).toBe(
			replId,
		);
	});

	it("starts with no head and nothing to resume", async () => {
		const { t, replId } = await chatOf("alice@example.com");
		expect((await t.run((ctx) => ctx.db.get(replId)))?.head).toBeUndefined();
		expect(await t.query(internal.repls.latest, { replId })).toBeNull();
	});
});

describe("repl layers", () => {
	it("moves the head and deepens with each layer", async () => {
		const { t, replId } = await chatOf("alice@example.com");
		const first = await t.mutation(internal.repls.record, {
			replId,
			...layer(1),
		});
		const second = await t.mutation(internal.repls.record, {
			replId,
			...layer(2, first),
		});
		expect((await t.run((ctx) => ctx.db.get(replId)))?.head).toBe(second);
		const rows = await t.run((ctx) => ctx.db.query("replLayers").collect());
		expect(rows.map((row) => [row._id, row.parent, row.depth])).toEqual([
			[first, undefined, 1],
			[second, first, 2],
		]);
		expect(rows.every((row) => row.bytes > 0)).toBe(true);
	});

	it("refuses a delta that is not over the head", async () => {
		const { t, replId } = await chatOf("alice@example.com");
		const first = await t.mutation(internal.repls.record, {
			replId,
			...layer(1),
		});
		await t.mutation(internal.repls.record, { replId, ...layer(2, first) });
		await expect(
			t.mutation(internal.repls.record, { replId, ...layer(3, first) }),
		).rejects.toThrow("STALE_HEAD");
		await expect(
			t.mutation(internal.repls.record, {
				replId,
				whole: false,
				chunks: ["{}"],
			}),
		).rejects.toThrow("STALE_HEAD");
	});

	it("takes a whole layer over any head", async () => {
		const { t, replId } = await chatOf("alice@example.com");
		const first = await t.mutation(internal.repls.record, {
			replId,
			...layer(1),
		});
		await t.mutation(internal.repls.record, { replId, ...layer(2, first) });
		const whole = await t.mutation(internal.repls.record, {
			replId,
			...layer(3),
		});
		const latest = await t.query(internal.repls.latest, { replId });
		expect(latest?.head).toBe(whole);
		expect(latest?.depth).toBe(3);
	});

	it("hands back the run from the nearest whole layer", async () => {
		const { t, replId } = await chatOf("alice@example.com");
		const first = await t.mutation(internal.repls.record, {
			replId,
			...layer(1),
		});
		const second = await t.mutation(internal.repls.record, {
			replId,
			...layer(2, first),
		});
		const third = await t.mutation(internal.repls.record, {
			replId,
			...layer(3),
		});
		await t.mutation(internal.repls.record, { replId, ...layer(4, third) });
		expect(second).not.toBe(third);
		const latest = await t.query(internal.repls.latest, { replId });
		expect(latest?.depth).toBe(4);
		expect(latest?.layers.map((chunks) => JSON.parse(chunks.join("")))).toEqual(
			[{ n: 3 }, { n: 4 }],
		);
	});

	it("splits a large layer across rows and joins it back", async () => {
		const { t, replId } = await chatOf("alice@example.com");
		const json = JSON.stringify({
			text: "x".repeat(REPL_LAYER_CHUNK_CHARS * 2),
		});
		const layerId = await t.mutation(internal.repls.record, {
			replId,
			whole: true,
			chunks: chunked(json),
		});
		expect((await t.run((ctx) => ctx.db.get(layerId)))?.chunks).toBe(3);
		const latest = await t.query(internal.repls.latest, { replId });
		expect(latest?.layers).toHaveLength(1);
		expect(latest?.layers[0]).toHaveLength(3);
		expect(latest?.layers[0].join("")).toBe(json);
	});

	it("refuses a chunk longer than a row holds", async () => {
		const { t, replId } = await chatOf("alice@example.com");
		await expect(
			t.mutation(internal.repls.record, {
				replId,
				whole: true,
				chunks: ["x".repeat(REPL_LAYER_CHUNK_CHARS + 1)],
			}),
		).rejects.toThrow("CHUNK_TOO_LARGE");
	});

	it("refuses a layer past the size limit", async () => {
		const { t, replId } = await chatOf("alice@example.com");
		await expect(
			t.mutation(internal.repls.record, {
				replId,
				whole: true,
				chunks: chunked("x".repeat(MAX_REPL_LAYER_BYTES + 1)),
			}),
		).rejects.toThrow("TOO_LARGE");
		expect(await t.query(internal.repls.latest, { replId })).toBeNull();
	});
});

describe("the convex image store", () => {
	it("resumes the image it saved last", async () => {
		const { t, replId } = await chatOf("alice@example.com");
		const store = new ConvexImageStore(replId, serverOf(t));
		await store.save(image(["a"]));
		await store.save(image(["a", "b"]));
		const resumed = await new ConvexImageStore(replId, serverOf(t)).latest();
		expect(resumed).toEqual({ depth: 2, image: image(["a", "b"]) });
		const rows = await t.run((ctx) => ctx.db.query("replLayers").collect());
		expect(rows.map((row) => row.whole)).toEqual([true, false]);
	});

	it("has nothing to resume before a save", async () => {
		const { t, replId } = await chatOf("alice@example.com");
		expect(
			await new ConvexImageStore(replId, serverOf(t)).latest(),
		).toBeUndefined();
	});

	it("saves a whole layer after losing a race for the head", async () => {
		const { t, replId } = await chatOf("alice@example.com");
		const winner = new ConvexImageStore(replId, serverOf(t));
		await winner.save(image(["a"]));
		const loser = new ConvexImageStore(replId, serverOf(t));
		await loser.latest();
		await winner.save(image(["a", "b"]));
		await expect(loser.save(image(["a", "c"]))).rejects.toThrow("STALE_HEAD");
		await loser.save(image(["a", "c"]));
		const resumed = await new ConvexImageStore(replId, serverOf(t)).latest();
		expect(resumed).toEqual({ depth: 3, image: image(["a", "c"]) });
	});
});
