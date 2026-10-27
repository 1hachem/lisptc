import type { ChatMessage } from "./chat.tsx";

declare const ordered: unique symbol;

export type Timeline = readonly ChatMessage[] & { readonly [ordered]: true };

export interface Sequenced {
	readonly seq: number;
	readonly message: ChatMessage;
}

export function timelineOf(
	stored: readonly Sequenced[],
	live: readonly ChatMessage[],
	running: boolean,
	pending?: ChatMessage,
): Timeline {
	const placed = new Set<string>();
	let previous = Number.NEGATIVE_INFINITY;
	for (const { seq, message } of stored) {
		if (seq <= previous)
			throw new Error(`the transcript is out of order at seq ${seq}`);
		previous = seq;
		if (message.id === undefined) continue;
		if (placed.has(message.id))
			throw new Error(`the transcript holds ${message.id} twice`);
		placed.add(message.id);
	}
	const fresh = new Map(live.map((message) => [message.id, message]));
	const shown: ChatMessage[] = stored.map(({ message }) =>
		running ? (fresh.get(message.id) ?? message) : message,
	);
	for (const message of [...live, ...(pending === undefined ? [] : [pending])])
		if (message.id === undefined || !placed.has(message.id)) {
			if (message.id !== undefined) placed.add(message.id);
			shown.push(message);
		}
	return shown as readonly ChatMessage[] as Timeline;
}
