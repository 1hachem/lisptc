import { applyPanelOps } from "@repo/shared/panel-layout";
import { emptyLayout, flatten, unflatten } from "@repo/shared/split-layout";
import { ConvexError, type Infer, v } from "convex/values";
import type { Id } from "./_generated/dataModel.js";
import {
	internalMutation,
	type MutationCtx,
	mutation,
	query,
} from "./_generated/server.js";
import { requireWorkspace } from "./lib/auth.js";
import { MAX_LAYOUT_BYTES, MAX_SPLITS } from "./limits.js";
import { panelContent, panelLayout, sidebars } from "./schema.js";

const encoder = new TextEncoder();

type PanelLayout = Infer<typeof panelLayout>;

type PanelContent = Infer<typeof panelContent>;

const split = v.union(v.literal("here"), v.literal("right"), v.literal("down"));

const panelOp = v.union(
	v.object({
		op: v.literal("open"),
		tab: v.string(),
		split,
		content: panelContent,
	}),
	v.object({ op: v.literal("close"), tab: v.string() }),
	v.object({ op: v.literal("focus"), tab: v.string() }),
);

function checked(layout: PanelLayout): PanelLayout {
	if (
		layout.nodes.some(
			(node) =>
				node.kind === "split" &&
				node.direction === "column" &&
				node.children.length > MAX_SPLITS,
		)
	) {
		throw new ConvexError({ code: "LAYOUT_TOO_MANY_SPLITS" });
	}
	if (encoder.encode(JSON.stringify(layout)).length > MAX_LAYOUT_BYTES) {
		throw new ConvexError({ code: "LAYOUT_TOO_LARGE" });
	}
	return layout;
}

async function stored(ctx: MutationCtx, workspaceId: Id<"workspaces">) {
	return await ctx.db
		.query("layouts")
		.withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
		.unique();
}

async function write(
	ctx: MutationCtx,
	workspaceId: Id<"workspaces">,
	layout: PanelLayout,
): Promise<null> {
	const existing = await stored(ctx, workspaceId);
	if (existing !== null) {
		await ctx.db.patch(existing._id, { layout });
		return null;
	}
	await ctx.db.insert("layouts", { workspaceId, layout });
	return null;
}

export const get = query({
	args: { workspaceId: v.id("workspaces") },
	returns: v.union(panelLayout, v.null()),
	handler: async (ctx, { workspaceId }) => {
		await requireWorkspace(ctx, workspaceId);
		const row = await ctx.db
			.query("layouts")
			.withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
			.unique();
		return row?.layout ?? null;
	},
});

export const put = mutation({
	args: { workspaceId: v.id("workspaces"), layout: panelLayout },
	returns: v.null(),
	handler: async (ctx, { workspaceId, layout }) => {
		await requireWorkspace(ctx, workspaceId);
		return await write(ctx, workspaceId, checked(layout));
	},
});

export const apply = mutation({
	args: { workspaceId: v.id("workspaces"), ops: v.array(panelOp) },
	returns: v.null(),
	handler: async (ctx, { workspaceId, ops }) => {
		await requireWorkspace(ctx, workspaceId);
		const row = await stored(ctx, workspaceId);
		const current =
			row === null
				? emptyLayout<PanelContent>()
				: unflatten<PanelContent>(row.layout);
		const next = flatten(applyPanelOps(current, ops));
		return await write(ctx, workspaceId, checked(next));
	},
});

export const trace = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
		shown: v.boolean(),
	},
	returns: v.boolean(),
	handler: async (ctx, { workspaceId, chatId, shown }) => {
		await requireWorkspace(ctx, workspaceId);
		const row = await stored(ctx, workspaceId);
		if (row === null) return false;
		const tabs = row.layout.nodes.flatMap((node) =>
			node.kind === "pane" ? node.tabs : [],
		);
		const beside = tabs.some(
			(tab) => tab.content.kind === "chat" && tab.content.chatId === chatId,
		);
		const alone = tabs
			.filter(
				(tab) => tab.content.kind === "trace" && tab.content.chatId === chatId,
			)
			.map((tab) => tab.id);
		const toggled: PanelLayout = {
			...row.layout,
			nodes: row.layout.nodes.map((node) =>
				node.kind === "pane"
					? {
							...node,
							tabs: node.tabs.map((tab) =>
								tab.content.kind === "chat" && tab.content.chatId === chatId
									? {
											...tab,
											content: {
												...tab.content,
												trace: {
													...tab.content.trace,
													shown: shown ? "open" : "collapsed",
												},
											},
										}
									: tab,
							),
						}
					: node,
			),
		};
		const next = shown
			? toggled
			: flatten(
					applyPanelOps(
						unflatten<PanelContent>(toggled),
						alone.map((tab) => ({ op: "close" as const, tab })),
					),
				);
		await write(ctx, workspaceId, checked(next));
		return beside;
	},
});

const side = v.union(v.literal("left"), v.literal("right"));

export const sidebarsShown = query({
	args: { workspaceId: v.id("workspaces") },
	returns: v.union(sidebars, v.null()),
	handler: async (ctx, { workspaceId }) => {
		await requireWorkspace(ctx, workspaceId);
		const row = await ctx.db
			.query("layouts")
			.withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
			.unique();
		return row?.sidebars ?? null;
	},
});

export const sidebar = mutation({
	args: { workspaceId: v.id("workspaces"), side, open: v.boolean() },
	returns: v.null(),
	handler: async (ctx, { workspaceId, side, open }) => {
		await requireWorkspace(ctx, workspaceId);
		const row = await stored(ctx, workspaceId);
		const shown = {
			...(row?.sidebars ?? { left: false, right: false }),
			[side]: open,
		};
		if (row !== null) {
			await ctx.db.patch(row._id, { sidebars: shown });
			return null;
		}
		await ctx.db.insert("layouts", {
			workspaceId,
			layout: flatten(emptyLayout<PanelContent>()),
			sidebars: shown,
		});
		return null;
	},
});

export const purge = internalMutation({
	args: { workspaceId: v.id("workspaces") },
	returns: v.null(),
	handler: async (ctx, { workspaceId }) => {
		const row = await ctx.db
			.query("layouts")
			.withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
			.unique();
		if (row !== null) await ctx.db.delete(row._id);
		return null;
	},
});
