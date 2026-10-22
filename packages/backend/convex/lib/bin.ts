import { internal } from "../_generated/api.js";
import type { Id } from "../_generated/dataModel.js";
import type { MutationCtx } from "../_generated/server.js";
import { type Folder, type FolderRow, freeIn } from "./files.js";
import { numbered } from "./names.js";

export async function intoBin(
	ctx: MutationCtx,
	row: FolderRow,
	from: Folder,
): Promise<string> {
	const name =
		(await freeIn(ctx, "bin", row.workspaceId, row.name)) ??
		numbered(row.name, row._id);
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

export async function trimBinLater(
	ctx: MutationCtx,
	workspaceId: Id<"workspaces">,
): Promise<void> {
	await ctx.scheduler.runAfter(0, internal.bin.trim, { workspaceId });
}
