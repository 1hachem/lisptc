import {
	type EventOwner,
	MemorySystemEventBox,
	type SystemEvent,
	type SystemEventBox,
} from "@repo/ai";

export const events: SystemEventBox = new MemorySystemEventBox();

export async function ticket(
	owner: EventOwner,
	event: SystemEvent,
): Promise<SystemEvent & { token: string }> {
	return { ...event, token: await events.issue(owner, event) };
}
