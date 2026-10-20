import { api } from "@repo/backend/api";
import { symbolsOf } from "@repo/language-service";
import { z } from "zod";
import { body } from "./body.ts";
import { convexAs } from "./convex.ts";
import { convexId } from "./ids.ts";
import { repls } from "./repls.ts";
import { type Authed, authed } from "./session.ts";

const symbolsSchema = z.object({ chatId: convexId<"chats">() });

export const symbols = {
	middleware: [...authed, body(symbolsSchema)] as const,
	handler: async ({
		context,
	}: Authed<z.infer<typeof symbolsSchema>>): Promise<Response> => {
		const convex = convexAs(context.session);
		await convex.query(api.chats.get, context.body);
		return Response.json(
			symbolsOf((await repls.get(context.body.chatId)).interp),
		);
	},
};
