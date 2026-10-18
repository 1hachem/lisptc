import type { Id } from "../_generated/dataModel.js";
import type { QueryCtx } from "../_generated/server.js";

const TURN_SCAN = 64;

function record(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

export function unansweredAsks(
	kwargs: Record<string, unknown> | undefined,
): string[] {
	const asks = record(kwargs?.asks);
	const answered = record(asks?.answered) ?? {};
	const open: unknown[] = Array.isArray(asks?.open) ? asks.open : [];
	return open.flatMap((ask) => {
		const id = record(ask)?.id;
		return typeof id === "string" && !(id in answered) ? [id] : [];
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
		if (unansweredAsks(message.kwargs).length > 0) return true;
	}
	return false;
}
