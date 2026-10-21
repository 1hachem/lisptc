import { v } from "convex/values";
import { internal } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";
import { internalMutation, type MutationCtx } from "./_generated/server.js";
import { UNCLAIMED_UPLOAD_TTL_MS } from "./limits.js";

const SWEEP_BATCH = 64;

async function claimed(
	ctx: MutationCtx,
	storageId: Id<"_storage">,
): Promise<boolean> {
	const holders = await Promise.all([
		ctx.db
			.query("knowledge")
			.withIndex("by_storage", (q) => q.eq("storageId", storageId))
			.first(),
		ctx.db
			.query("attachments")
			.withIndex("by_storage", (q) => q.eq("storageId", storageId))
			.first(),
		ctx.db
			.query("bin")
			.withIndex("by_storage", (q) => q.eq("storageId", storageId))
			.first(),
	]);
	return holders.some((holder) => holder !== null);
}

export const sweep = internalMutation({
	args: { cursor: v.optional(v.union(v.string(), v.null())) },
	returns: v.null(),
	handler: async (ctx, { cursor = null }) => {
		const cutoff = Date.now() - UNCLAIMED_UPLOAD_TTL_MS;
		const { page, isDone, continueCursor } = await ctx.db.system
			.query("_storage")
			.paginate({ cursor, numItems: SWEEP_BATCH });
		for (const blob of page)
			if (blob._creationTime < cutoff && !(await claimed(ctx, blob._id)))
				await ctx.storage.delete(blob._id);
		const reachedRecent = page.some((blob) => blob._creationTime >= cutoff);
		if (!isDone && !reachedRecent)
			await ctx.scheduler.runAfter(0, internal.uploads.sweep, {
				cursor: continueCursor,
			});
		return null;
	},
});
