import { v } from "convex/values";
import type { Id } from "../_generated/dataModel.js";
import type { QueryCtx } from "../_generated/server.js";

export const storedFile = v.union(
	v.object({
		name: v.string(),
		contentType: v.union(v.string(), v.null()),
		size: v.number(),
		url: v.union(v.string(), v.null()),
	}),
	v.null(),
);

export async function withUrl(
	ctx: QueryCtx,
	row: {
		name: string;
		contentType?: string;
		size: number;
		storageId: Id<"_storage">;
	} | null,
) {
	if (row === null) return null;
	return {
		name: row.name,
		contentType: row.contentType ?? null,
		size: row.size,
		url: await ctx.storage.getUrl(row.storageId),
	};
}
