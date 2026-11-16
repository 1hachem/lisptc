import {
	checked,
	type Entry,
	type EntryKind,
	entryKind,
	every,
} from "@repo/shared/journal";
import { z } from "zod";

export const RECIPIENTS = ["user", "model"] as const;

export type Recipient = (typeof RECIPIENTS)[number];

const recipient = z.enum(RECIPIENTS);

export interface Printed {
	readonly to: readonly Recipient[];
	readonly text: string;
}

export const printed = entryKind<Printed, Printed[]>({
	name: "printed",
	schema: z.object({ to: z.array(recipient).min(1), text: z.string() }),
	fold: every,
});

export interface Hitch {
	readonly kind: "skipped" | "failed" | "held";
	readonly text: string;
	readonly hold?: string;
}

export const hitch = entryKind<Hitch, Hitch[]>({
	name: "hitch",
	schema: z.object({
		kind: z.enum(["skipped", "failed", "held"]),
		text: z.string(),
		hold: z.string().optional(),
	}),
	fold: every,
});

export interface Released {
	readonly hold: string;
	readonly granted: boolean;
}

export const released = entryKind<Released, Released[]>({
	name: "released",
	schema: z.object({ hold: z.string(), granted: z.boolean() }),
	fold: every,
});

export interface Sink {
	send(entry: Entry): boolean;
	close?(): void;
}

type Listener = (entry: Entry) => void;

export class Journal {
	private readonly listeners = new Map<string, Set<Listener>>();
	private readonly allKinds = new Set<Listener>();
	private readonly sinks = new Set<Sink>();
	private written = 0;
	evaluation = 0;

	write<T, V>(kind: EntryKind<T, V>, value: T): void {
		checked(kind, value);
		this.written += 1;
		this.deliver({
			id: `${this.evaluation}.${this.written}`,
			kind: kind.name,
			value,
			...(kind.supersedes ? { supersedes: true } : {}),
		});
	}

	on<T, V>(
		kind: EntryKind<T, V>,
		listener: (value: T, entry: Entry) => void,
	): () => void {
		let set = this.listeners.get(kind.name);
		if (set === undefined) {
			set = new Set();
			this.listeners.set(kind.name, set);
		}
		const unwrapped: Listener = (entry) => listener(entry.value as T, entry);
		set.add(unwrapped);
		return () => {
			set.delete(unwrapped);
		};
	}

	onAny(listener: Listener): () => void {
		this.allKinds.add(listener);
		return () => {
			this.allKinds.delete(listener);
		};
	}

	pipe(sink: Sink): () => void {
		this.sinks.add(sink);
		return () => {
			if (this.sinks.delete(sink)) sink.close?.();
		};
	}

	private deliver(entry: Entry): void {
		const broken: string[] = [];
		for (const listener of [
			...(this.listeners.get(entry.kind) ?? []),
			...this.allKinds,
		])
			try {
				listener(entry);
			} catch (ex) {
				broken.push(ex instanceof Error ? ex.message : String(ex));
			}
		for (const sink of [...this.sinks])
			try {
				if (!sink.send(entry)) this.sinks.delete(sink);
			} catch {
				this.sinks.delete(sink);
			}
		if (entry.kind === hitch.name) return;
		for (const message of broken)
			this.write(hitch, {
				kind: "failed",
				text: `a listener on ${entry.kind} threw: ${message}`,
			});
	}
}

export function print(
	journal: Journal | undefined,
	addressed: Partial<Record<Recipient, string>>,
): void {
	if (journal === undefined) return;
	const groups = new Map<string, Recipient[]>();
	for (const to of RECIPIENTS) {
		const text = addressed[to];
		if (text === undefined) continue;
		const recipients = groups.get(text);
		if (recipients === undefined) groups.set(text, [to]);
		else recipients.push(to);
	}
	for (const [text, to] of groups) journal.write(printed, { to, text });
}

export interface JournalBuffer extends Sink {
	readonly entries: readonly Entry[];
	collect<T, V>(kind: EntryKind<T, V>): T[];
	collectText(to: Recipient): string;
}

export function bufferSink(): JournalBuffer {
	const entries: Entry[] = [];
	const collect = <T, V>(kind: EntryKind<T, V>): T[] =>
		entries.filter((e) => e.kind === kind.name).map((e) => e.value as T);
	return {
		entries,
		send(entry) {
			entries.push(entry);
			return true;
		},
		collect,
		collectText(to) {
			return collect(printed)
				.filter((p) => p.to.includes(to))
				.map((p) => p.text)
				.join("");
		},
	};
}
