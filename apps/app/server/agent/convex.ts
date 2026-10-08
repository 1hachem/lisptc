import { webEnv } from "@repo/env/web";
import { ConvexHttpClient } from "convex/browser";
import type { Session } from "./session.ts";

export function convexAs(session: Session): ConvexHttpClient {
	const client = new ConvexHttpClient(webEnv.CONVEX_URL);
	client.setAuth(session.token);
	return client;
}
