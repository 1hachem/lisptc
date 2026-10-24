import type { Id } from "../_generated/dataModel.js";
import type { MutationCtx } from "../_generated/server.js";

export async function claimed(
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
