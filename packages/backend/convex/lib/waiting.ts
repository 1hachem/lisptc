import type { Id } from "../_generated/dataModel.js";
import type { QueryCtx } from "../_generated/server.js";

const TURN_SCAN = 64;

function record(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function unanswered(kwargs: Record<string, unknown> | undefined): boolean {
	const asks = record(kwargs?.asks);
	const answered = record(asks?.answered) ?? {};
	const open = Array.isArray(asks?.open) ? asks.open : [];
	return open.some((ask) => {
		const id = record(ask)?.id;
		return typeof id === "string" && !(id in answered);
	});
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
