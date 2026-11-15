import { topic } from "./channels.ts";
import { Interp, type InterpOptions } from "./lisp.ts";
import {
	arrayToList,
	Cell,
	type List,
	listToArray,
	newSym,
} from "./objects.ts";

type Speaker = "user" | "assistant" | "tool" | "system";

export interface Said {
	readonly role: Speaker;
	readonly content: string;
	readonly source?: string;
}

export interface Conversation {
	said(): readonly Said[];
	append(source: string, content: string): void;
}

export const appended = topic<Said>("conversation");

export type ConversationInterp = Interp & {
	readonly conversation: Conversation;
};

const LIVE_DOC = "Read-only live conversation state (auto-updated each step).";
const OWNER = "conversation";

function toAlist(said: Said): List {
	const pairs = [
		new Cell("role", said.role),
		new Cell("content", said.content),
	];
	if (said.source !== undefined) pairs.push(new Cell("source", said.source));
	return arrayToList(pairs);
}

function fromAlist(alist: unknown): Said {
	const fields = new Map<unknown, unknown>(
		listToArray(alist as List).map((pair) => [
			(pair as Cell).car,
			(pair as Cell).cdr,
		]),
	);
	const source = fields.get("source");
	return {
		role: fields.get("role") as Speaker,
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
			said: () => this.said(),
			append: (source, content) => {
				if (content === "") return;
				appended.emit(this.channels, {
					model: { role: "system", content, source },
				});
			},
		};
	}

	seed(said: readonly Said[], stepsTaken: number): void {
		this.write(said);
		this.live("steps-taken", BigInt(stepsTaken));
	}

	carryFrom(previous: ConversationInterpreter): void {
		this.write(previous.said());
		this.live("steps-taken", previous.getGlobal(newSym("steps-taken")));
	}

	private said(): readonly Said[] {
		const sym = newSym("conversation");
		if (!this.hasGlobal(sym)) return [];
		return listToArray(this.getGlobal(sym) as List).map(fromAlist);
	}

	private write(said: readonly Said[]): void {
		const user = said.filter((s) => s.role === "user").map((s) => s.content);
		const assistant = said
			.filter((s) => s.role === "assistant")
			.map((s) => s.content);
		this.live("conversation", arrayToList(said.map(toAlist)));
		this.live("user-messages", arrayToList(user));
		this.live("assistant-messages", arrayToList(assistant));
	}

	private live(name: string, value: unknown): void {
		const sym = newSym(name);
		this.defineGlobal(sym, value, { signature: name, doc: LIVE_DOC });
		this.seal(sym, OWNER);
	}
}
