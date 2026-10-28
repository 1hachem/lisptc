import { internal } from "@repo/backend/api";
import type { Id } from "@repo/backend/dataModel";
import type { Machine } from "@repo/desktop-protocol";
import { convexAsServer } from "../agent/convex.ts";
import type { Presence } from "./sockets.ts";

const instance = crypto.randomUUID();

export async function announce(
	userId: Id<"users">,
	machine: Machine,
): Promise<Presence> {
	const presence = {
		userId,
		machineId: machine.id,
		connection: crypto.randomUUID(),
	};
	await convexAsServer
		.mutation(internal.desktops.attach, {
			...presence,
			label: machine.label,
			instance,
		})
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
