import { Migrations } from "@convex-dev/migrations";
import { LayerCursor } from "@repo/repl/image-store";
import { components, internal } from "./_generated/api.js";
import type { DataModel, Doc, Id } from "./_generated/dataModel.js";
import type { QueryCtx } from "./_generated/server.js";
import { chunked } from "./lib/chunks.js";
import { retiredModelReset } from "./lib/models.js";

export const migrations = new Migrations<DataModel>(components.migrations);

export const run = migrations.runner();

export const resetRetiredModels = migrations.define({
	table: "workspaces",
	migrateOne: (_ctx, workspace) => retiredModelReset(workspace.model),
});

async function legacyLayer(
	ctx: QueryCtx,
	replId: Id<"repls">,
	call: number,
): Promise<Doc<"replLayers"> | null> {
	return await ctx.db
		.query("replLayers")
		.withIndex("by_repl_call", (q) =>
			q.eq("replId", replId).eq("legacyCall", call),
		)
		.first();
}

export const layerReplImages = migrations.define({
	table: "replImages",
	migrateOne: async (ctx, image) => {
		const rows = await ctx.db
			.query("replImageChunks")
			.withIndex("by_image", (q) => q.eq("imageId", image._id))
			.collect();
		const kept =
			(await ctx.db.get(image.replId)) !== null &&
			(await legacyLayer(ctx, image.replId, image.call)) === null;
		if (kept) {
			const layer = new LayerCursor().over(
				JSON.parse(rows.map((row) => row.data).join("")),
			);
			const chunks = chunked(JSON.stringify(layer));
			const layerId = await ctx.db.insert("replLayers", {
				replId: image.replId,
				depth: image.call,
				whole: true,
				bytes: image.bytes,
				chunks: chunks.length,
				legacyCall: image.call,
			});
			for (const [index, data] of chunks.entries())
				await ctx.db.insert("replLayerChunks", { layerId, index, data });
		}
		for (const row of rows) await ctx.db.delete(row._id);
		await ctx.db.delete(image._id);
	},
});

export const pointRepls = migrations.define({
	table: "repls",
	migrateOne: async (ctx, repl) => {
		if (repl.chatId !== undefined && repl.call === undefined) return;
		const chat = await ctx.db
			.query("chats")
			.withIndex("by_repl", (q) => q.eq("replId", repl._id))
			.first();
		const legacy = await ctx.db
			.query("replLayers")
			.withIndex("by_repl_call", (q) =>
				q.eq("replId", repl._id).gte("legacyCall", 0),
			)
			.order("desc")
			.first();
		await ctx.db.patch(repl._id, {
			chatId: repl.chatId ?? chat?._id,
			head: repl.head ?? legacy?._id,
			call: undefined,
			bytes: undefined,
		});
	},
});

function withoutCall(
	kwargs: Record<string, unknown>,
): Record<string, unknown> | undefined {
	const { call: _call, ...rest } = kwargs;
	return Object.keys(rest).length > 0 ? rest : undefined;
}

export const pointMessages = migrations.define({
	table: "chats",
	migrateOne: async (ctx, chat) => {
		let ran = 0;
		let current: Id<"replLayers"> | undefined;
		const messages = ctx.db
			.query("messages")
			.withIndex("by_chat_seq", (q) => q.eq("chatId", chat._id));
		for await (const message of messages) {
			if (message.layerId !== undefined) {
				current = message.layerId;
				continue;
			}
			const call = message.kwargs?.call;
			if (typeof call === "number" && call > ran && chat.replId) {
				ran = call;
				current = (await legacyLayer(ctx, chat.replId, call))?._id ?? current;
			}
			if (typeof call === "number" || current !== undefined)
				await ctx.db.patch(message._id, {
					layerId: current,
					...(message.kwargs === undefined
						? {}
						: { kwargs: withoutCall(message.kwargs) }),
				});
		}
	},
});

export const runAll = migrations.runner([
	internal.migrations.resetRetiredModels,
	internal.migrations.layerReplImages,
	internal.migrations.pointRepls,
	internal.migrations.pointMessages,
]);
