import { ConvexError, v } from "convex/values";
import type { TableNames } from "../_generated/dataModel.js";
import { internalQuery } from "../_generated/server.js";

const MAX_IDS = 256;

export function existingIn(table: TableNames) {
	return internalQuery({
		args: { ids: v.array(v.string()) },
		returns: v.array(v.string()),
		handler: async (ctx, { ids }) => {
			if (ids.length > MAX_IDS) throw new ConvexError({ code: "TOO_MANY" });
			const found: string[] = [];
			for (const id of ids) {
				const normalized = ctx.db.normalizeId(table, id);
				if (normalized !== null && (await ctx.db.get(normalized)) !== null)
					found.push(id);
			}
			return found;
		},
	});
}
