import { createMiddleware } from "@tanstack/react-start";
import { z } from "zod";

export function body<T extends z.ZodType>(schema: T) {
	return createMiddleware({ type: "request" }).server(
		async ({ request, pathname, next }) => {
			const parsed = schema.safeParse(await request.json().catch(() => null));
			if (!parsed.success) {
				const error = z.treeifyError(parsed.error);
				console.warn(`rejected ${request.method} ${pathname}:`, error);
				return Response.json({ error }, { status: 400 });
			}
			return next({ context: { body: parsed.data } });
		},
	);
}
