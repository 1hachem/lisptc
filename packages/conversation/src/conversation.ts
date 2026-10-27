import { conversationSlot } from "@repo/interpreter/conversation";
import type { Interp } from "@repo/interpreter/lisp";
import {
	arrayToList,
	Cell,
	listToArray,
	newSym,
	type Sym,
} from "@repo/interpreter/objects";
import type {
	ConversationEntry,
	InterpExtension,
	Problem,
	SessionHooks,
} from "@repo/interpreter/session";
import type { PromptSource } from "@repo/shared/host";

export interface ConversationHost {
	prompt: PromptSource;
}

const OWNER = "conversation";
const CONVERSATION = newSym("conversation");
const USER_MESSAGES = newSym("user-messages");
const ASSISTANT_MESSAGES = newSym("assistant-messages");

const DOCS: readonly [Sym, string][] = [
	[
		CONVERSATION,
		"Read-only transcript of this chat, one alist per message, grown as the conversation goes on.",
	],
	[USER_MESSAGES, "Read-only list of the user's message strings."],
	[ASSISTANT_MESSAGES, "Read-only list of the assistant's message strings."],
];

const ROLES: readonly ConversationEntry["role"][] = [
	"user",
	"assistant",
	"system",
	"tool",
];

function alist(pairs: readonly [string, unknown][]): unknown {
	return arrayToList(pairs.map(([key, value]) => new Cell(key, value)));
}

function field(record: unknown, key: string): unknown {
	if (!(record instanceof Cell)) return undefined;
	for (const pair of listToArray(record))
		if (pair instanceof Cell && pair.car === key) return pair.cdr;
	return undefined;
}

function items(list: unknown): unknown[] {
	return list instanceof Cell ? listToArray(list) : [];
}

function encodeProblem({ line, message }: Problem): unknown {
	return alist([
		["line", line],
		["message", message],
	]);
}

function encode({ role, content, problems }: ConversationEntry): unknown {
	const pairs: [string, unknown][] = [
		["role", role],
		["content", content],
	];
	if (problems !== undefined && problems.length > 0)
		pairs.push(["problems", arrayToList(problems.map(encodeProblem))]);
	return alist(pairs);
}

function decodeProblem(record: unknown): Problem | undefined {
	const line = field(record, "line");
	const message = field(record, "message");
	if (typeof line !== "number" || typeof message !== "string") return undefined;
	return { line, message };
}

function decode(record: unknown): ConversationEntry | undefined {
	const role = ROLES.find((known) => known === field(record, "role"));
	const content = field(record, "content");
	if (role === undefined || typeof content !== "string") return undefined;
	const problems = items(field(record, "problems")).flatMap(
		(problem) => decodeProblem(problem) ?? [],
	);
	return { role, content, ...(problems.length > 0 ? { problems } : {}) };
}

function entries(interp: Interp): readonly ConversationEntry[] {
	return items(interp.getGlobal(CONVERSATION)).flatMap(
		(record) => decode(record) ?? [],
	);
}

function append(interp: Interp, sym: Sym, value: unknown): void {
	interp.defineGlobal(
		sym,
		arrayToList([...items(interp.getGlobal(sym)), value]),
	);
}

function recorded(interp: Interp, entry: ConversationEntry): void {
	append(interp, CONVERSATION, encode(entry));
	if (entry.role === "user") append(interp, USER_MESSAGES, entry.content);
	if (entry.role === "assistant")
		append(interp, ASSISTANT_MESSAGES, entry.content);
}

function install(interp: Interp): void {
	for (const [sym, doc] of DOCS) {
		interp.defineGlobal(sym, null, { signature: sym.name, doc });
		interp.seal(sym, OWNER);
	}
}

export function conversationExtension(host: ConversationHost): InterpExtension {
	return Object.assign(install, {
		prompt: host.prompt(),
		session(hooks: SessionHooks): void {
			hooks.fill(conversationSlot, { entries });
			hooks.recorded.use((interp, entry, next) => {
				recorded(interp, entry);
				next(interp, entry);
			});
		},
	});
}
