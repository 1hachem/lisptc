import { api } from "@repo/backend/api";
import { toolkitEntries } from "@repo/backend/mcp-actions";
import { z } from "zod";
import { body } from "./body.ts";
import { convexAs } from "./convex.ts";
import { convexId } from "./ids.ts";
import { type Authed, authed } from "./session.ts";

const mcpToolkitSchema = z.object({ workspaceId: convexId<"workspaces">() });

export const mcpToolkit = {
	middleware: [...authed, body(mcpToolkitSchema)] as const,
	handler: async ({
		context,
	}: Authed<z.infer<typeof mcpToolkitSchema>>): Promise<Response> => {
		await convexAs(context.session).query(api.workspaces.get, context.body);
		return Response.json(toolkitEntries());
	},
};
