import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel.js";
import { mutation, query } from "./_generated/server.js";
import { requireUser } from "./lib/auth.js";
import { MAX_PREFERENCES_BYTES } from "./limits.js";

const encoder = new TextEncoder();

const preferences = v.object({
	theme: v.optional(v.string()),
	font: v.optional(v.string()),
	themeUses: v.optional(v.record(v.string(), v.number())),
	channels: v.optional(v.record(v.string(), v.boolean())),
	metadata: v.optional(v.record(v.string(), v.boolean())),
});

function stripped(row: Doc<"preferences"> | null) {
	if (row === null) return {};
	const { _id, _creationTime, userId, ...stored } = row;
	return stored;
}

export const get = query({
	args: {},
	returns: v.union(preferences, v.null()),
	handler: async (ctx) => {
		const user = await requireUser(ctx);
		const row = await ctx.db
			.query("preferences")
			.withIndex("by_user", (q) => q.eq("userId", user._id))
			.unique();
		return row === null ? null : stripped(row);
	},
});

export const put = mutation({
	args: { preferences },
	returns: v.null(),
	handler: async (ctx, { preferences }) => {
		const user = await requireUser(ctx);
		const existing = await ctx.db
			.query("preferences")
			.withIndex("by_user", (q) => q.eq("userId", user._id))
			.unique();
		const fields = { ...stripped(existing), ...preferences, userId: user._id };
		if (encoder.encode(JSON.stringify(fields)).length > MAX_PREFERENCES_BYTES) {
			throw new ConvexError({ code: "PREFERENCES_TOO_LARGE" });
		}
		if (existing !== null) {
			await ctx.db.replace(existing._id, fields);
			return null;
		}
		await ctx.db.insert("preferences", fields);
		return null;
	},
});
