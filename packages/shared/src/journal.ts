import { z } from "zod";
import { ENVELOPE_KEYS } from "./messages.ts";

const entry = z.object({
	id: z.string(),
	kind: z.string(),
	value: z.unknown(),
	about: z.string().optional(),
	supersedes: z.literal(true).optional(),
});

export type Entry = z.infer<typeof entry>;

export interface EntryKind<T, V> {
	readonly name: string;
	readonly schema: z.ZodType<T>;
	readonly supersedes?: true;
	fold(values: readonly T[]): V;
}

const RESERVED: ReadonlySet<string> = new Set(ENVELOPE_KEYS);

export function entryKind<T, V>(kind: EntryKind<T, V>): EntryKind<T, V> {
	if (RESERVED.has(kind.name))
		throw new Error(
			`entry kind "${kind.name}" is a message envelope field; pick another name`,
		);
	return kind;
}

function last<T>(values: readonly T[]): T | undefined {
	return values.at(-1);
}

export function latestOnly<T>(kind: {
	readonly name: string;
	readonly schema: z.ZodType<T>;
}): EntryKind<T, T | undefined> {
	return entryKind({ ...kind, supersedes: true, fold: last });
}

export function every<T>(values: readonly T[]): T[] {
	return [...values];
}

export function checked<T, V>(kind: EntryKind<T, V>, value: T): T {
	const parsed = kind.schema.safeParse(value);
	if (!parsed.success)
		throw new Error(
			`a "${kind.name}" entry does not fit its kind: ${parsed.error.message}`,
		);
	return value;
}

export function view<T, V>(
	entries: readonly Entry[],
	kind: EntryKind<T, V>,
): V {
	const values: T[] = [];
	for (const entry of entries) {
		if (entry.kind !== kind.name) continue;
		const parsed = kind.schema.safeParse(entry.value);
		if (parsed.success) values.push(parsed.data);
	}
	return kind.fold(values);
}

export type Received = Record<string, unknown>;

export function readReceived<T, V>(
	received: Received | undefined,
	kind: EntryKind<T, V>,
): T | undefined {
	return received === undefined
		? undefined
		: kind.schema.safeParse(received[kind.name]).data;
}

export const ENTRY_TYPE = "entry";

interface EntryRow {
	readonly type: string;
	readonly id?: string;
	readonly additional_kwargs?: Record<string, unknown>;
}

export function entryOf(row: EntryRow): Entry | undefined {
	if (row.type !== ENTRY_TYPE) return undefined;
	return entry.safeParse({ id: row.id ?? "", ...row.additional_kwargs }).data;
}

export function entriesIn(rows: readonly EntryRow[]): Entry[] {
	const entries: Entry[] = [];
	for (const row of rows) {
		const read = entryOf(row);
		if (read !== undefined) entries.push(read);
	}
	return entries;
}
