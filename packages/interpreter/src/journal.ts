import type { Entry, EntryKind } from "@repo/shared/journal";
import { type Channels, topic } from "./channels.ts";

export const journal = topic<Entry>("journal");

export function record<T>(
	channels: Channels | undefined,
	kind: EntryKind<T>,
	value: T,
): void {
	journal.emit(channels, { harness: { kind: kind.name, value } });
}
