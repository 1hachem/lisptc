import { webEnv } from "@repo/env/web";
import { edge } from "./edge.ts";

export const health = {
	middleware: edge,
	handler: async (): Promise<Response> => {
		const convex = await fetch(new URL("/version", webEnv.CONVEX_URL), {
			signal: AbortSignal.timeout(2000),
		})
			.then((response) => response.ok)
			.catch(() => false);
		return Response.json(
			{ ok: convex, convex },
			{ status: convex ? 200 : 503 },
		);
	},
};
