import { internal } from "@repo/backend/api";
import type { Id } from "@repo/backend/dataModel";
import { convexAsServer } from "../agent/convex.ts";
import type { Presence } from "./sockets.ts";

const instance = crypto.randomUUID();

export async function announce(userId: Id<"users">): Promise<Presence> {
	const presence = { userId, connection: crypto.randomUUID() };
	await convexAsServer
		.mutation(internal.desktops.attach, { ...presence, instance })
		.catch(() => {});
	return presence;
}

export async function seen(presence: Presence): Promise<void> {
	await convexAsServer
		.mutation(internal.desktops.seen, presence)
		.catch(() => {});
}

export async function withdraw(presence: Presence): Promise<void> {
	await convexAsServer
		.mutation(internal.desktops.detach, presence)
		.catch(() => {});
}
