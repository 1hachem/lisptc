import { questionKey, readAnnotation } from "@repo/interpreter/annotations";
import { asksKey, unansweredAsks } from "@repo/interpreter/asks";
import type { Id } from "../_generated/dataModel.js";
import type { QueryCtx } from "../_generated/server.js";

const TURN_SCAN = 64;

function unanswered(kwargs: Record<string, unknown> | undefined): boolean {
	return (
		unansweredAsks(readAnnotation(kwargs, asksKey)).length > 0 ||
		readAnnotation(kwargs, questionKey) !== undefined
	);
}

export async function waitsOnUser(
	ctx: QueryCtx,
	chatId: Id<"chats">,
): Promise<boolean> {
	const latest = await ctx.db
		.query("messages")
		.withIndex("by_chat_seq", (q) => q.eq("chatId", chatId))
		.order("desc")
		.take(TURN_SCAN);
	for (const message of latest) {
		if (message.type === "human" || message.type === "system") return false;
		if (unanswered(message.kwargs)) return true;
	}
	return false;
}
