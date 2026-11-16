import { topic } from "./channels.ts";
import { Interp, type InterpOptions } from "./lisp.ts";
import {
	arrayToList,
	Cell,
	type List,
	listToArray,
	newSym,
} from "./objects.ts";

type Role = "user" | "assistant" | "tool" | "system";

export interface ConversationRecord {
	readonly role: Role;
	readonly content: string;
	readonly source?: string;
}

export interface Conversation {
	records(): readonly ConversationRecord[];
	append(source: string, content: string): void;
	request(source: string, content: string): void;
}

export const note = topic<ConversationRecord>("note");

export type ConversationInterp = Interp & {
	readonly conversation: Conversation;
};

const LIVE_DOC = "Read-only live conversation state (auto-updated each step).";
const OWNER = "conversation";

function toAlist(record: ConversationRecord): List {
	const pairs = [
		new Cell("role", record.role),
		new Cell("content", record.content),
	];
	if (record.source !== undefined)
		pairs.push(new Cell("source", record.source));
	return arrayToList(pairs);
}

function fromAlist(alist: unknown): ConversationRecord {
	const fields = new Map<unknown, unknown>(
		listToArray(alist as List).map((pair) => [
			(pair as Cell).car,
			(pair as Cell).cdr,
		]),
	);
	const source = fields.get("source");
	return {
		role: fields.get("role") as Role,
		content: String(fields.get("content") ?? ""),
		...(typeof source === "string" ? { source } : {}),
	};
}

export class ConversationInterpreter
	extends Interp
	implements ConversationInterp
{
	readonly conversation: Conversation;
	constructor(options: InterpOptions = {}) {
		super(options);
		this.write([]);
		this.live("steps-taken", 0n);
		this.conversation = {
			records: () => this.records(),
			append: (source, content) => this.emit("system", source, content),
			request: (source, content) => this.emit("user", source, content),
		};
	}

	private emit(role: Role, source: string, content: string): void {
		if (content === "") return;
		note.emit(this.channels, { model: { role, content, source } });
	}

	seed(records: readonly ConversationRecord[], stepsTaken: number): void {
		this.write(records);
		this.live("steps-taken", BigInt(stepsTaken));
	}

	carryFrom(previous: ConversationInterpreter): void {
		this.write(previous.records());
		this.live("steps-taken", previous.getGlobal(newSym("steps-taken")));
	}

	private records(): readonly ConversationRecord[] {
		const sym = newSym("conversation");
		if (!this.hasGlobal(sym)) return [];
		return listToArray(this.getGlobal(sym) as List).map(fromAlist);
	}

	private write(records: readonly ConversationRecord[]): void {
		const user = records
			.filter((s) => s.role === "user" && s.source === undefined)
			.map((s) => s.content);
		const assistant = records
			.filter((s) => s.role === "assistant")
			.map((s) => s.content);
		this.live("conversation", arrayToList(records.map(toAlist)));
		this.live("user-messages", arrayToList(user));
		this.live("assistant-messages", arrayToList(assistant));
	}

	private live(name: string, value: unknown): void {
		const sym = newSym(name);
		this.defineGlobal(sym, value, { signature: name, doc: LIVE_DOC });
		this.seal(sym, OWNER);
	}
}
