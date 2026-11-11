import { api } from "@repo/backend/api";
import type { Id } from "@repo/backend/dataModel";
import {
	MCP_ACTIONS,
	MCP_SERVER_NAME,
	runMcpAction,
} from "@repo/backend/mcp-actions";
import { z } from "zod";
import { body } from "./body.ts";
import { convexAs } from "./convex.ts";
import { HttpError } from "./error.ts";
import { convexId } from "./ids.ts";
import { type Authed, authed, type Session } from "./session.ts";
import { chatRepl, workspaceRepl } from "./threads.ts";

const mcpActionSchema = z.object({
	workspaceId: convexId<"workspaces">(),
	chatId: convexId<"chats">().optional(),
	server: z.string().regex(MCP_SERVER_NAME),
	action: z.enum(MCP_ACTIONS),
});

async function dedicatedRepl(
	session: Session,
	workspaceId: Id<"workspaces">,
	chatId: Id<"chats">,
) {
	const chat = await convexAs(session).query(api.chats.get, { chatId });
	if (chat.workspaceId !== workspaceId)
		throw new HttpError(404, "no such chat in this workspace");
	return await chatRepl(chatId);
}

async function sharedRepl(session: Session, workspaceId: Id<"workspaces">) {
	await convexAs(session).query(api.workspaces.get, { workspaceId });
	return await workspaceRepl(workspaceId);
}

export const mcpAction = {
	middleware: [...authed, body(mcpActionSchema)] as const,
	handler: async ({
		context,
	}: Authed<z.infer<typeof mcpActionSchema>>): Promise<Response> => {
		const { workspaceId, chatId, server, action } = context.body;
		const result =
			chatId === undefined
				? await runMcpAction(
						await sharedRepl(context.session, workspaceId),
						server,
						action,
					)
				: await runMcpAction(
						await dedicatedRepl(context.session, workspaceId, chatId),
						server,
						action,
						"dedicated",
					);
		return Response.json(result, { status: "error" in result ? 409 : 200 });
	},
};
