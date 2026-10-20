import { api } from "@repo/backend/api";
import { symbolsOf } from "@repo/language-service";
import { z } from "zod";
import { body } from "./body.ts";
import { convexAs } from "./convex.ts";
import { convexId } from "./ids.ts";
import { drafts, repls } from "./repls.ts";
import { type Authed, authed } from "./session.ts";

const symbolsSchema = z.union([
	z.object({ chatId: convexId<"chats">() }),
	z.object({ workspaceId: convexId<"workspaces">() }),
]);

export const symbols = {
	middleware: [...authed, body(symbolsSchema)] as const,
	handler: async ({
		context,
	}: Authed<z.infer<typeof symbolsSchema>>): Promise<Response> => {
		const convex = convexAs(context.session);
		const target = context.body;
		if ("chatId" in target) {
			await convex.query(api.chats.get, target);
			return Response.json(symbolsOf((await repls.get(target.chatId)).interp));
		}
		await convex.query(api.workspaces.get, target);
		return Response.json(
			symbolsOf((await drafts.get(target.workspaceId)).interp),
		);
	},
};
