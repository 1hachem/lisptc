import { api } from "@repo/backend/api";
import type { Id } from "@repo/backend/dataModel";
import { convexAs } from "../agent/convex.ts";
import { verifyToken } from "../agent/session.ts";

export async function attachDesktop(
	token: string,
): Promise<Id<"users"> | null> {
	const session = await verifyToken(token);
	if (session === null) return null;
	const me = await convexAs(session)
		.query(api.users.me, {})
		.catch(() => null);
	return me?._id ?? null;
}
