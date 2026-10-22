import { v } from "convex/values";
import { internal } from "./_generated/api.js";
import { internalMutation } from "./_generated/server.js";
import { claimed } from "./lib/claimed.js";
import { UNCLAIMED_UPLOAD_TTL_MS } from "./limits.js";

const SWEEP_BATCH = 64;

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
