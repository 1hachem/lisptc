import { v } from "convex/values";
import type { Doc } from "../_generated/dataModel.js";
import type { QueryCtx } from "../_generated/server.js";

export const servedFile = v.union(
	v.object({
		name: v.string(),
		contentType: v.union(v.string(), v.null()),
		size: v.number(),
		url: v.union(v.string(), v.null()),
	}),
	v.null(),
);

export async function served(
	ctx: QueryCtx,
	row: Doc<"knowledge"> | Doc<"attachments"> | null,
) {
	if (row === null) return null;
	return {
		name: row.name,
		contentType: row.contentType ?? null,
		size: row.size,
		url: await ctx.storage.getUrl(row.storageId),
	};
}
