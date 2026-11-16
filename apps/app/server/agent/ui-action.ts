import type { UiActionResult } from "@repo/ai";
import { api } from "@repo/backend/api";
import type { Id } from "@repo/backend/dataModel";
import { z } from "zod";
import { body } from "./body.ts";
import { convexAs } from "./convex.ts";
import { convexId } from "./ids.ts";
import { type Authed, authed } from "./session.ts";
import { answer } from "./threads.ts";

const uiActionSchema = z.object({
	chatId: convexId<"chats">(),
	messageId: z.string().optional(),
	action: z.string(),
	values: z.record(z.string(), z.union([z.string(), z.boolean()])).optional(),
});

async function recordEntries(
	convex: ReturnType<typeof convexAs>,
	chatId: Id<"chats">,
	about: string,
	entries: UiActionResult["entries"],
): Promise<void> {
	if (entries.length === 0) return;
	await convex.mutation(api.messages.record, {
		chatId,
		about,
		entries: entries.map(({ kind, value }) => ({ kind, value })),
	});
}

export const uiAction = {
	middleware: [...authed, body(uiActionSchema)] as const,
	handler: async ({
		context,
	}: Authed<z.infer<typeof uiActionSchema>>): Promise<Response> => {
		const { chatId, messageId, action, values } = context.body;
		const convex = convexAs(context.session);
		await convex.query(api.chats.get, { chatId });
		const result = await answer(chatId, action, values ?? {}, messageId);
		const { entries, ...reply } = result;
		if (messageId !== undefined)
			await recordEntries(convex, chatId, messageId, entries);
		console.log(
			`ui action chat=${chatId} action=${action}${result.message ? " sent" : ""}${result.error ? " error" : ""}`,
		);
		return Response.json(reply);
	},
};
