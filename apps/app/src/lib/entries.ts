import { ENTRY_TYPE, type Entry, entryOf } from "@repo/shared/journal";
import { envelopeOf } from "@repo/shared/messages";
import type { ChatMessage } from "./chat.tsx";

interface Pending {
	readonly row: ChatMessage;
	readonly entry: Entry;
}

export type Placement = "carried" | "standing" | "dropped";

export type EntryCarrier = Pick<
	ChatMessage,
	"type" | "additional_kwargs" | "entries"
>;

export function isEntryMessage(message: EntryCarrier): boolean {
	return message.type === ENTRY_TYPE;
}

class Folding {
	readonly out: ChatMessage[] = [];
	private readonly carried = new Map<ChatMessage, Entry[]>();

	constructor(
		private readonly place: (entry: Entry) => Placement,
		private readonly about: ReadonlyMap<string, ChatMessage>,
	) {}

	carry(carrier: ChatMessage, entry: Entry): void {
		const held = this.carried.get(carrier);
		if (held === undefined) this.carried.set(carrier, [entry]);
		else held.push(entry);
	}

	private claimed(row: ChatMessage, entry: Entry): ChatMessage | undefined {
		if (entry.about !== undefined) {
			const target = this.about.get(entry.about);
			if (target !== undefined) return target;
		}
		const { holding } = envelopeOf(row.additional_kwargs);
		if (holding === undefined) return undefined;
		for (let at = this.out.length - 1; at >= 0; at--) {
			const message = this.out[at];
			if (
				message?.type === "tool" &&
				envelopeOf(message.additional_kwargs).holding === holding
			)
				return message;
		}
		return undefined;
	}

	settle(run: readonly Pending[], next: ChatMessage | undefined): void {
		const before = this.out.at(-1);
		let synthesized: ChatMessage | undefined;
		for (const { row, entry } of run) {
			const placement = this.place(entry);
			if (placement === "dropped") continue;
			if (placement === "standing") {
				this.out.push(row);
				continue;
			}
			const claimed = this.claimed(row, entry);
			if (claimed !== undefined) {
				this.carry(claimed, entry);
				continue;
			}
			if (next?.type === "tool") this.carry(next, entry);
			else if (before?.type === "tool") this.carry(before, entry);
			else if (next?.type === "ai" && before?.type !== "ai")
				this.carry(next, entry);
			else {
				if (synthesized === undefined) {
					synthesized = {
						id: `${row.id ?? this.out.length}:entries`,
						type: "tool",
						content: "",
						additional_kwargs: { quiet: true },
					};
					this.out.push(synthesized);
				}
				this.carry(synthesized, entry);
			}
		}
	}

	folded(): ChatMessage[] {
		return this.out.map((message) => {
			const entries = this.carried.get(message);
			return entries === undefined
				? message
				: { ...message, entries: [...(message.entries ?? []), ...entries] };
		});
	}
}

function targetsById(
	messages: readonly ChatMessage[],
): Map<string, ChatMessage> {
	const shown = messages.filter((message) => !isEntryMessage(message));
	const targets = new Map<string, ChatMessage>();
	shown.forEach((message, at) => {
		if (message.id === undefined) return;
		const result = shown[at + 1];
		if (message.type !== "ai") targets.set(message.id, message);
		else if (result?.type === "tool") targets.set(message.id, result);
	});
	return targets;
}

export function foldEntries(
	messages: readonly ChatMessage[],
	place: (entry: Entry) => Placement = () => "carried",
): ChatMessage[] {
	if (!messages.some(isEntryMessage)) return [...messages];
	const folding = new Folding(place, targetsById(messages));
	let run: Pending[] = [];
	for (const message of messages) {
		if (isEntryMessage(message)) {
			const entry = entryOf(message);
			if (entry !== undefined) run.push({ row: message, entry });
			continue;
		}
		folding.settle(run, message);
		run = [];
		folding.out.push(message);
	}
	folding.settle(run, undefined);
	return folding.folded();
}

export function entriesOfMessage(message: EntryCarrier): readonly Entry[] {
	if (isEntryMessage(message)) {
		const entry = entryOf(message);
		return entry === undefined ? [] : [entry];
	}
	return message.entries ?? [];
}
