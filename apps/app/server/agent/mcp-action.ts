import { api } from "@repo/backend/api";
import {
	MCP_ACTIONS,
	MCP_SERVER_NAME,
	runMcpAction,
} from "@repo/backend/mcp-actions";
import { z } from "zod";
import { body } from "./body.ts";
import { convexAs } from "./convex.ts";
import { convexId } from "./ids.ts";
import { type Authed, authed } from "./session.ts";
import { workspaceRepl } from "./threads.ts";

const mcpActionSchema = z.object({
	workspaceId: convexId<"workspaces">(),
	server: z.string().regex(MCP_SERVER_NAME),
	action: z.enum(MCP_ACTIONS),
});

export const mcpAction = {
	middleware: [...authed, body(mcpActionSchema)] as const,
	handler: async ({
		context,
	}: Authed<z.infer<typeof mcpActionSchema>>): Promise<Response> => {
		const { workspaceId, server, action } = context.body;
		await convexAs(context.session).query(api.workspaces.get, { workspaceId });
		const result = await runMcpAction(
			await workspaceRepl(workspaceId),
			server,
			action,
		);
		return Response.json(result, { status: "error" in result ? 409 : 200 });
	},
};
