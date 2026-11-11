import { toolkitEntries } from "@repo/backend/mcp-actions";
import { z } from "zod";
import { body } from "./body.ts";
import { type Authed, authed } from "./session.ts";

const mcpToolkitSchema = z.object({});

export const mcpToolkit = {
	middleware: [...authed, body(mcpToolkitSchema)] as const,
	handler: async (
		_: Authed<z.infer<typeof mcpToolkitSchema>>,
	): Promise<Response> => Response.json(toolkitEntries()),
};
