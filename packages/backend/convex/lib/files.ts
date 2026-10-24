import type { Infer } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel.js";
import type { MutationCtx, QueryCtx } from "../_generated/server.js";
import { MAX_ATTACHMENTS, MAX_KNOWLEDGE } from "../limits.js";
import type { binnedFrom } from "../schema.js";
import { freeName } from "./names.js";

export type Folder = Infer<typeof binnedFrom>;

export const FILE_TABLES = ["knowledge", "attachments", "bin"] as const;

export type FileTable = (typeof FILE_TABLES)[number];

export type FolderRow = Doc<Folder>;

const byName = (a: { name: string }, b: { name: string }) =>
	a.name.localeCompare(b.name);
const newestFirst = (a: { addedAt: number }, b: { addedAt: number }) =>
	b.addedAt - a.addedAt;

export const FOLDERS: Record<
	Folder,
	{
		limit: number;
		replacesOnAdd: boolean;
		order: (
			a: { name: string; addedAt: number },
			b: { name: string; addedAt: number },
		) => number;
	}
> = {
	knowledge: { limit: MAX_KNOWLEDGE, replacesOnAdd: true, order: byName },
	attachments: {
		limit: MAX_ATTACHMENTS,
		replacesOnAdd: false,
		order: newestFirst,
	},
};

export function addedAt(row: FolderRow): number {
	return "attachedAt" in row ? row.attachedAt : row._creationTime;
}

export async function held<T extends FileTable>(
	ctx: QueryCtx | MutationCtx,
	table: T,
	workspaceId: Id<"workspaces">,
	name: string,
): Promise<Doc<T> | null> {
	const files: FileTable = table;
	return (await ctx.db
		.query(files)
		.withIndex("by_workspace_name", (q) =>
			q.eq("workspaceId", workspaceId).eq("name", name),
		)
		.unique()) as Doc<T> | null;
}

export async function owned<T extends FileTable>(
	ctx: QueryCtx | MutationCtx,
	table: T,
	workspaceId: Id<"workspaces">,
	limit: number,
): Promise<Doc<T>[]> {
	const files: FileTable = table;
	return (await ctx.db
		.query(files)
		.withIndex("by_workspace_name", (q) => q.eq("workspaceId", workspaceId))
		.take(limit)) as unknown as Doc<T>[];
}

export async function isFull(
	ctx: QueryCtx | MutationCtx,
	into: Folder,
	workspaceId: Id<"workspaces">,
): Promise<boolean> {
	const { limit } = FOLDERS[into];
	return (await owned(ctx, into, workspaceId, limit)).length >= limit;
}

export async function freeIn(
	ctx: QueryCtx | MutationCtx,
	table: FileTable,
	workspaceId: Id<"workspaces">,
	name: string,
): Promise<string | null> {
	return await freeName(
		async (candidate) =>
			(await held(ctx, table, workspaceId, candidate)) !== null,
		name,
	);
}

export interface StoredFile {
	workspaceId: Id<"workspaces">;
	name: string;
	storageId: Id<"_storage">;
	contentType?: string;
	size: number;
}

export async function insertInto(
	ctx: MutationCtx,
	into: Folder,
	stored: StoredFile,
): Promise<void> {
	if (into === "attachments")
		await ctx.db.insert(into, { ...stored, attachedAt: Date.now() });
	else await ctx.db.insert(into, stored);
}

export async function erase(
	ctx: MutationCtx,
	row: Doc<FileTable>,
): Promise<void> {
	await ctx.storage.delete(row.storageId);
	await ctx.db.delete(row._id);
}
