import { runUiAction, type UiActionResult } from "@repo/ai";
import { api } from "@repo/backend/api";
import type { Id } from "@repo/backend/dataModel";
import { z } from "zod";
import { body } from "./body.ts";
import { convexAs } from "./convex.ts";
import { ticket } from "./events.ts";
import { convexId } from "./ids.ts";
import { repls } from "./repls.ts";
import { type Authed, authed } from "./session.ts";

const uiActionSchema = z.object({
	chatId: convexId<"chats">(),
	messageId: z.string().optional(),
	action: z.string(),
	values: z.record(z.string(), z.union([z.string(), z.boolean()])).optional(),
});

async function annotateMessage(
	convex: ReturnType<typeof convexAs>,
	chatId: Id<"chats">,
	id: string,
	kwargs: UiActionResult["annotations"],
): Promise<void> {
	if (kwargs === undefined || Object.keys(kwargs).length === 0) return;
	await convex.mutation(api.messages.annotate, { chatId, id, kwargs });
}

export const uiAction = {
	middleware: [...authed, body(uiActionSchema)] as const,
	handler: async ({
		context,
	}: Authed<z.infer<typeof uiActionSchema>>): Promise<Response> => {
		const { chatId, messageId, action, values } = context.body;
		const convex = convexAs(context.session);
		await convex.query(api.chats.get, { chatId });
		const result = await runUiAction(repls, chatId, action, values ?? {});
		if (!result) {
			console.log(`ui action chat=${chatId} action=${action} no-session`);
			return Response.json({ error: "session expired" }, { status: 409 });
		}
		const { annotations, ...reply } = result;
		if (messageId !== undefined && !result.error)
			await annotateMessage(convex, chatId, messageId, annotations);
		const event =
			result.message === undefined || result.error
				? undefined
				: await ticket(
						{ subject: context.session.subject, chatId },
						{ source: action, text: result.message },
					);
		console.log(
			`ui action chat=${chatId} action=${action}${result.message ? " sent" : ""}${result.error ? " error" : ""}`,
		);
		return Response.json(event === undefined ? reply : { ...reply, event });
	},
};
