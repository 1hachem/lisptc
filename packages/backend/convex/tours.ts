import {
	tourLabels as wireLabels,
	pointer as wirePointer,
	tourStep as wireStep,
} from "@repo/ui-catalog";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api.js";
import type { Doc, Id } from "./_generated/dataModel.js";
import {
	internalMutation,
	type MutationCtx,
	mutation,
	query,
} from "./_generated/server.js";
import { requireChat, requireUser, requireUserOrThread } from "./lib/auth.js";
import { POINTER_TTL_MS, TOUR_TTL_MS } from "./limits.js";
import { pointerMark, pointerSize, tourLabels, tourStep } from "./schema.js";

const PURGE_BATCH = 256;

const MAX_STEPS = 20;

async function pauseActive(
	ctx: MutationCtx,
	userId: Id<"users">,
	keep?: Id<"tours">,
): Promise<void> {
	const active = await ctx.db
		.query("tours")
		.withIndex("by_user_status", (q) =>
			q.eq("userId", userId).eq("status", "active"),
		)
		.collect();
	for (const row of active)
		if (row._id !== keep) await ctx.db.patch(row._id, { status: "paused" });
}

export async function pauseChatTours(
	ctx: MutationCtx,
	chatId: Id<"chats">,
): Promise<void> {
	const rows = await ctx.db
		.query("tours")
		.withIndex("by_chat_tour", (q) => q.eq("chatId", chatId))
		.collect();
	for (const row of rows)
		if (row.status === "active")
			await ctx.db.patch(row._id, { status: "paused" });
}

async function owned(
	ctx: MutationCtx,
	tour: Id<"tours">,
): Promise<Doc<"tours">> {
	const user = await requireUser(ctx);
	const row = await ctx.db.get(tour);
	if (row === null || row.userId !== user._id)
		throw new ConvexError({ code: "FORBIDDEN" });
	return row;
}

async function finish(
	ctx: MutationCtx,
	row: Doc<"tours">,
	status: "done" | "skipped",
): Promise<void> {
	await ctx.db.patch(row._id, { status });
	const at = Date.now();
	const progress = await ctx.db
		.query("tourProgress")
		.withIndex("by_user_tour", (q) =>
			q.eq("userId", row.userId).eq("tourId", row.tourId),
		)
		.unique();
	if (progress === null)
		await ctx.db.insert("tourProgress", {
			userId: row.userId,
			tourId: row.tourId,
			status,
			at,
		});
	else if (progress.status !== "done")
		await ctx.db.patch(progress._id, { status, at });
}

export const start = mutation({
	args: {
		chatId: v.id("chats"),
		tourId: v.string(),
		steps: v.array(tourStep),
		labels: v.optional(tourLabels),
		done: v.optional(v.string()),
		skip: v.optional(v.string()),
	},
	returns: v.null(),
	handler: async (ctx, { chatId, tourId, steps, labels, done, skip }) => {
		const { user, chat } = await requireChat(ctx, chatId);
		if (
			steps.length === 0 ||
			steps.length > MAX_STEPS ||
			!steps.every((step) => wireStep.safeParse(step).success) ||
			(labels !== undefined && !wireLabels.safeParse(labels).success)
		)
			throw new ConvexError({ code: "TOUR_INVALID" });
		const row = await ctx.db
			.query("tours")
			.withIndex("by_chat_tour", (q) =>
				q.eq("chatId", chatId).eq("tourId", tourId),
			)
			.unique();
		const fields = {
			steps,
			current: 0,
			status: "active" as const,
			labels,
			done,
			skip,
			expiresAt: Date.now() + TOUR_TTL_MS,
		};
		if (row !== null) await ctx.db.patch(row._id, fields);
		const id =
			row?._id ??
			(await ctx.db.insert("tours", {
				workspaceId: chat.workspaceId,
				chatId,
				userId: user._id,
				tourId,
				...fields,
			}));
		await pauseActive(ctx, user._id, id);
		return null;
	},
});

export const active = query({
	args: {},
	returns: v.union(
		v.object({
			_id: v.id("tours"),
			chatId: v.id("chats"),
			tourId: v.string(),
			steps: v.array(tourStep),
			current: v.number(),
			labels: v.optional(tourLabels),
			done: v.optional(v.string()),
			skip: v.optional(v.string()),
			expiresAt: v.number(),
		}),
		v.null(),
	),
	handler: async (ctx) => {
		const user = await requireUser(ctx);
		const row = await ctx.db
			.query("tours")
			.withIndex("by_user_status", (q) =>
				q.eq("userId", user._id).eq("status", "active"),
			)
			.order("desc")
			.first();
		if (row === null || row.expiresAt <= Date.now()) return null;
		const {
			_id,
			chatId,
			tourId,
			steps,
			current,
			labels,
			done,
			skip,
			expiresAt,
		} = row;
		return {
			_id,
			chatId,
			tourId,
			steps,
			current,
			labels,
			done,
			skip,
			expiresAt,
		};
	},
});

export const advance = mutation({
	args: { tour: v.id("tours"), from: v.number() },
	returns: v.null(),
	handler: async (ctx, { tour, from }) => {
		const row = await owned(ctx, tour);
		if (row.status !== "active" || row.current !== from) return null;
		if (row.expiresAt <= Date.now()) {
			await ctx.db.patch(row._id, { status: "paused" });
			return null;
		}
		if (from + 1 >= row.steps.length) await finish(ctx, row, "done");
		else await ctx.db.patch(row._id, { current: from + 1 });
		return null;
	},
});

export const skip = mutation({
	args: { tour: v.id("tours") },
	returns: v.null(),
	handler: async (ctx, { tour }) => {
		const row = await owned(ctx, tour);
		if (row.status === "active" || row.status === "paused")
			await finish(ctx, row, "skipped");
		return null;
	},
});

export const point = mutation({
	args: {
		chatId: v.id("chats"),
		anchor: v.string(),
		mark: pointerMark,
		size: pointerSize,
		click: v.boolean(),
		open: v.optional(v.string()),
	},
	returns: v.null(),
	handler: async (ctx, { chatId, anchor, mark, size, click, open }) => {
		const { user, chat } = await requireChat(ctx, chatId);
		if (!wirePointer.safeParse({ anchor, mark, size, click, open }).success)
			throw new ConvexError({ code: "POINTER_INVALID" });
		const held = await ctx.db
			.query("pointers")
			.withIndex("by_user", (q) => q.eq("userId", user._id))
			.collect();
		for (const row of held) await ctx.db.delete(row._id);
		const id = await ctx.db.insert("pointers", {
			workspaceId: chat.workspaceId,
			chatId,
			userId: user._id,
			anchor,
			mark,
			size,
			click,
			open,
			expiresAt: Date.now() + POINTER_TTL_MS,
		});
		await ctx.scheduler.runAfter(POINTER_TTL_MS, internal.tours.forgetPointer, {
			pointer: id,
		});
		return null;
	},
});

export const forgetPointer = internalMutation({
	args: { pointer: v.id("pointers") },
	returns: v.null(),
	handler: async (ctx, { pointer }) => {
		if ((await ctx.db.get(pointer)) !== null) await ctx.db.delete(pointer);
		return null;
	},
});

export const pointer = query({
	args: {},
	returns: v.union(
		v.object({
			_id: v.id("pointers"),
			anchor: v.string(),
			mark: pointerMark,
			size: pointerSize,
			click: v.boolean(),
			open: v.optional(v.string()),
		}),
		v.null(),
	),
	handler: async (ctx) => {
		const user = await requireUser(ctx);
		const row = await ctx.db
			.query("pointers")
			.withIndex("by_user", (q) => q.eq("userId", user._id))
			.first();
		if (row === null || row.expiresAt <= Date.now()) return null;
		const { _id, anchor, mark, size, click, open } = row;
		return { _id, anchor, mark, size, click, open };
	},
});

export const finished = query({
	args: { tourId: v.string() },
	returns: v.boolean(),
	handler: async (ctx, { tourId }) => {
		const user = await requireUserOrThread(ctx);
		const progress = await ctx.db
			.query("tourProgress")
			.withIndex("by_user_tour", (q) =>
				q.eq("userId", user._id).eq("tourId", tourId),
			)
			.unique();
		return progress?.status === "done";
	},
});

export const purge = internalMutation({
	args: { chatId: v.id("chats") },
	returns: v.null(),
	handler: async (ctx, { chatId }) => {
		const rows = await ctx.db
			.query("tours")
			.withIndex("by_chat_tour", (q) => q.eq("chatId", chatId))
			.take(PURGE_BATCH);
		for (const row of rows) await ctx.db.delete(row._id);
		const pointers = await ctx.db
			.query("pointers")
			.withIndex("by_chat", (q) => q.eq("chatId", chatId))
			.take(PURGE_BATCH);
		for (const row of pointers) await ctx.db.delete(row._id);
		if (rows.length === PURGE_BATCH || pointers.length === PURGE_BATCH)
			await ctx.scheduler.runAfter(0, internal.tours.purge, { chatId });
		return null;
	},
});
