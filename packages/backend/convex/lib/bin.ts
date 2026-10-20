import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel.js";
import type { MutationCtx, QueryCtx } from "../_generated/server.js";
import { freeName } from "./names.js";

export type BinnedFrom = Doc<"bin">["from"];

export async function heldInBin(
	ctx: QueryCtx | MutationCtx,
	workspaceId: Id<"workspaces">,
	name: string,
) {
	return await ctx.db
		.query("bin")
		.withIndex("by_workspace_name", (q) =>
			q.eq("workspaceId", workspaceId).eq("name", name),
		)
		.unique();
}

export async function intoBin(
	ctx: MutationCtx,
	row: Doc<"knowledge"> | Doc<"attachments">,
	from: BinnedFrom,
): Promise<string> {
	const name = await freeName(
		async (candidate) =>
			(await heldInBin(ctx, row.workspaceId, candidate)) !== null,
		row.name,
	);
	if (name === null) throw new ConvexError({ code: "BIN_NAME_TAKEN" });
	await ctx.db.insert("bin", {
		workspaceId: row.workspaceId,
		name,
		from,
		storageId: row.storageId,
		contentType: row.contentType,
		size: row.size,
		binnedAt: Date.now(),
	});
	await ctx.db.delete(row._id);
	return name;
}
