import type { z } from "zod";
import { ENVELOPE_KEYS } from "./messages.ts";

export interface Entry {
	readonly kind: string;
	readonly value: unknown;
}

export interface EntryKind<T> {
	readonly name: string;
	readonly schema: z.ZodType<T>;
}

const RESERVED: ReadonlySet<string> = new Set(ENVELOPE_KEYS);

export function entryKind<T>(kind: EntryKind<T>): EntryKind<T> {
	if (RESERVED.has(kind.name))
		throw new Error(
			`entry kind "${kind.name}" is a message envelope field; pick another name`,
		);
	return kind;
}

export function readEntry<T>(entry: Entry, kind: EntryKind<T>): T | undefined {
	return entry.kind === kind.name
		? kind.schema.safeParse(entry.value).data
		: undefined;
}

export function entriesOf<T>(
	entries: readonly Entry[],
	kind: EntryKind<T>,
): T[] {
	const values: T[] = [];
	for (const entry of entries) {
		const value = readEntry(entry, kind);
		if (value !== undefined) values.push(value);
	}
	return values;
}

export function latest<T>(
	entries: readonly Entry[],
	kind: EntryKind<T>,
): T | undefined {
	return entriesOf(entries, kind).at(-1);
}

export type Received = Record<string, unknown>;

export function readReceived<T>(
	received: Received | undefined,
	kind: EntryKind<T>,
): T | undefined {
	return received === undefined
		? undefined
		: kind.schema.safeParse(received[kind.name]).data;
}
