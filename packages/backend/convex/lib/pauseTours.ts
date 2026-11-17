import type { Id } from "../_generated/dataModel.js";
import type { MutationCtx } from "../_generated/server.js";

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
