import { checked, type Entry, type EntryKind } from "@repo/shared/journal";
import { type Channels, topic } from "./channels.ts";

export const journal = topic<Entry>("journal");

const recordedOn = new WeakMap<Channels, number>();

export function record<T, V>(
	channels: Channels | undefined,
	kind: EntryKind<T, V>,
	value: T,
): void {
	checked(kind, value);
	if (channels === undefined) return;
	const stamped =
		kind.stamp === undefined ? value : kind.stamp(value, channels.clock.now());
	const n = (recordedOn.get(channels) ?? 0) + 1;
	recordedOn.set(channels, n);
	journal.emit(channels, {
		harness: {
			id: `${channels.step}.${n}`,
			kind: kind.name,
			value: stamped,
			...(kind.supersedes ? { supersedes: true } : {}),
		},
	});
}
