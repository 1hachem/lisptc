import { asksKind, unansweredAsks } from "@repo/journal-catalog/asks";
import { questionKind } from "@repo/journal-catalog/intent";
import { entriesIn, view } from "@repo/shared/journal";
import type { Id } from "../_generated/dataModel.js";
import type { QueryCtx } from "../_generated/server.js";

async function latestTurn(ctx: QueryCtx, chatId: Id<"chats">) {
	const turn = [];
	for await (const message of ctx.db
		.query("messages")
		.withIndex("by_chat_seq", (q) => q.eq("chatId", chatId))
		.order("desc")) {
		if (message.type === "human" || message.type === "system") break;
		turn.push({ type: message.type, additional_kwargs: message.kwargs });
	}
	return turn.reverse();
}

export async function waitsOnUser(
	ctx: QueryCtx,
	chatId: Id<"chats">,
): Promise<boolean> {
	const entries = entriesIn(await latestTurn(ctx, chatId));
	return (
		unansweredAsks(view(entries, asksKind)).length > 0 ||
		view(entries, questionKind) !== undefined
	);
}
