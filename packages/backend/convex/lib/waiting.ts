import { asksOf, unansweredAsks } from "@repo/interpreter/asks";
import { latest, questionKind } from "@repo/interpreter/journal";
import { entriesIn } from "@repo/shared/messages";
import type { Doc, Id } from "../_generated/dataModel.js";
import type { QueryCtx } from "../_generated/server.js";

const TURN_SCAN = 64;

function latestTurn(newestFirst: readonly Doc<"messages">[]) {
	const turn = [];
	for (const message of newestFirst) {
		if (message.type === "human" || message.type === "system") break;
		turn.push({ type: message.type, additional_kwargs: message.kwargs });
	}
	return turn.reverse();
}

export async function waitsOnUser(
	ctx: QueryCtx,
	chatId: Id<"chats">,
): Promise<boolean> {
	const newestFirst = await ctx.db
		.query("messages")
		.withIndex("by_chat_seq", (q) => q.eq("chatId", chatId))
		.order("desc")
		.take(TURN_SCAN);
	const entries = entriesIn(latestTurn(newestFirst));
	return (
		unansweredAsks(asksOf(entries)).length > 0 ||
		latest(entries, questionKind) !== undefined
	);
}
