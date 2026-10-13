import type { Infer } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel.js";
import type { MutationCtx } from "../_generated/server.js";
import type { messageType } from "../schema.js";
import { clamp } from "./clamp.js";

export interface Appended {
	id?: string;
	type: Infer<typeof messageType>;
	content: string;
	kwargs?: Record<string, unknown>;
}

export async function appendMessages(
	ctx: MutationCtx,
	chat: Doc<"chats">,
	messages: Appended[],
): Promise<Id<"messages">[]> {
	const last = await ctx.db
		.query("messages")
		.withIndex("by_chat_seq", (q) => q.eq("chatId", chat._id))
		.order("desc")
		.first();
	let seq = last === null ? 0 : last.seq + 1;
	const ids = [];
	for (const entry of messages) {
		const clamped = clamp(entry.content, entry.kwargs);
		ids.push(
			await ctx.db.insert("messages", {
				chatId: chat._id,
				workspaceId: chat.workspaceId,
				seq,
				type: entry.type,
				content: clamped.content,
				kwargs: clamped.kwargs,
				truncated: clamped.truncated ? true : undefined,
				wireId: entry.id,
			}),
		);
		seq += 1;
	}
	await ctx.db.patch(chat._id, { lastMessageAt: Date.now() });
	return ids;
}
