import { finishOAuth } from "@repo/backend/oauth-callback";
import { z } from "zod";
import { body } from "./body.ts";
import { convexAs } from "./convex.ts";
import { type Authed, authed } from "./session.ts";

const oauthCallbackSchema = z.object({ url: z.url() });

export const oauthCallback = {
	middleware: [...authed, body(oauthCallbackSchema)] as const,
	handler: async ({
		context,
	}: Authed<z.infer<typeof oauthCallbackSchema>>): Promise<Response> => {
		const current = context.session;
		const finished = await finishOAuth(
			() => convexAs(current),
			context.body.url,
		);
		if (finished === null) {
			return Response.json(
				{ error: "no authorization is waiting for this link" },
				{ status: 404 },
			);
		}
		console.log("oauth callback finished");
		return Response.json({ ok: true, server: finished.server });
	},
};
