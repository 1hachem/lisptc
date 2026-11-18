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
import { signIn, testDeployment } from "./helpers.ts";

async function chatOf(email: string) {
	const t = testDeployment();
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
});

describe("repl layers", () => {
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

	it("refuses a layer past the size limit and keeps nothing of it", async () => {
		const { t, replId } = await chatOf("alice@example.com");
		await expect(
			new ConvexImageStore(replId, serverOf(t)).save(
				image(["x".repeat(MAX_REPL_LAYER_BYTES + 1)]),
			),
		).rejects.toThrow("TOO_LARGE");
		expect(
			await new ConvexImageStore(replId, serverOf(t)).latest(),
		).toBeUndefined();
	});
});

describe("the convex image store", () => {
	it("resumes an image larger than a row holds", async () => {
		const { t, replId } = await chatOf("alice@example.com");
		const large = image(["x".repeat(REPL_LAYER_CHUNK_CHARS * 2)]);
		await new ConvexImageStore(replId, serverOf(t)).save(large);
		const resumed = await new ConvexImageStore(replId, serverOf(t)).latest();
		expect(resumed?.image).toEqual(large);
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
