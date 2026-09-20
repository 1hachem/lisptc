import { apiEnv } from "@repo/env/api";
import { ConvexHttpClient } from "convex/browser";
import type { Session } from "./session.ts";

export function convexAs(session: Session): ConvexHttpClient {
	const client = new ConvexHttpClient(apiEnv.CONVEX_URL);
	client.setAuth(session.token);
	return client;
}
