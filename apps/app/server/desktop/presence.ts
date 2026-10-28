import { internal } from "@repo/backend/api";
import type { Id } from "@repo/backend/dataModel";
import { DESKTOP_HEARTBEAT_MS } from "@repo/backend/limits";
import { convexAsServer } from "../agent/convex.ts";

const instance = crypto.randomUUID();

let beating: ReturnType<typeof setInterval> | undefined;

function beat(): void {
	if (beating !== undefined) return;
	beating = setInterval(() => {
		void convexAsServer
			.mutation(internal.desktops.heartbeat, { instance })
			.catch(() => {});
	}, DESKTOP_HEARTBEAT_MS);
	beating.unref?.();
}

export interface Presence {
	readonly userId: Id<"users">;
	readonly connection: string;
}

export async function announce(userId: Id<"users">): Promise<Presence> {
	const presence = { userId, connection: crypto.randomUUID() };
	beat();
	await convexAsServer
		.mutation(internal.desktops.attach, { ...presence, instance })
		.catch(() => {});
	return presence;
}

export async function withdraw(presence: Presence): Promise<void> {
	await convexAsServer
		.mutation(internal.desktops.detach, presence)
		.catch(() => {});
}
