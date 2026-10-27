import {
	actingAs,
	type Owner,
	serverClient,
} from "@repo/backend/server-client";
import { webEnv } from "@repo/env/web";
import { ConvexHttpClient } from "convex/browser";
import type { Session } from "./session.ts";

export function convexAs(session: Session): ConvexHttpClient {
	const client = new ConvexHttpClient(webEnv.CONVEX_URL);
	client.setAuth(session.token);
	return client;
}

export const convexAsServer = serverClient(
	new ConvexHttpClient(webEnv.CONVEX_URL),
	webEnv.CONVEX_SELF_HOSTED_ADMIN_KEY,
);

export function convexActingAs(owner: Owner): ConvexHttpClient {
	return actingAs(
		new ConvexHttpClient(webEnv.CONVEX_URL),
		webEnv.CONVEX_SELF_HOSTED_ADMIN_KEY,
		owner,
	);
}
