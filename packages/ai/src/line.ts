import type { ConversationRecord } from "@repo/interpreter/conversation";
import { ENTRY_TYPE } from "@repo/shared/journal";
import {
	type ChatMessage,
	contentToText,
	envelopeOf,
	type MessageKwargs,
} from "@repo/shared/messages";
import type { Mail } from "./mailbox.ts";

export interface ChatMessageInput {
	id?: string;
	type?: string;
	role?: string;
	content?: unknown;
	additional_kwargs?: MessageKwargs;
}

export interface WireMessage {
	type: string;
	content: string;
	id: string;
	additional_kwargs?: MessageKwargs;
}

interface RecordLine {
	readonly kind: "record";
	readonly record: ConversationRecord;
	readonly failed?: true;
}

interface SpokenLine {
	readonly kind: "user" | "assistant" | "result";
	readonly text: string;
}

export type Line = SpokenLine | RecordLine;

type PromptLine = SpokenLine & { readonly kind: "user" };

export type PostedLine = PromptLine | RecordLine;

const UNSOURCED = "system";

const REPL_PROMPT = "lisptc>";

export function isPrompt(line: Line): line is PromptLine {
	return line.kind === "user";
}

export function mailLine(mail: Mail): PostedLine {
	if (mail.kind === "user") return { kind: "user", text: mail.text };
	return {
		kind: "record",
		record: {
			role: mail.noted ? "system" : "user",
			content: mail.text,
			source: mail.source,
		},
		...(mail.failed ? { failed: true as const } : {}),
	};
}

export function lineRecord(line: Line): ConversationRecord {
	switch (line.kind) {
		case "user":
		case "assistant":
			return { role: line.kind, content: line.text };
		case "result":
			return { role: "tool", content: line.text };
		case "record":
			return line.record;
	}
}

export function lineChat(line: Line): ChatMessage {
	switch (line.kind) {
		case "assistant":
			return { role: "assistant", content: line.text };
		case "user":
			return { role: "user", content: line.text };
		case "result":
			return { role: "user", content: transcript(line.text) };
		case "record":
			return recordChat(line.record);
	}
}

function recordChat({
	role,
	content,
	source = UNSOURCED,
}: ConversationRecord): ChatMessage {
	return {
		role: "developer",
		content: role === "user" ? `from ${source}:\n${content}` : content,
	};
}

export function lineWire(line: PostedLine, id: string): WireMessage {
	if (line.kind === "user") return { type: "human", content: line.text, id };
	const { role, content, source = UNSOURCED } = line.record;
	return {
		type: "system",
		content,
		id,
		additional_kwargs: {
			source,
			...(line.failed ? { failed: true } : {}),
			...(role === "user" ? {} : { noted: true }),
		},
	};
}

export function wireType(
	type: string | undefined,
): "human" | "ai" | "system" | "tool" | typeof ENTRY_TYPE {
	if (type === ENTRY_TYPE) return ENTRY_TYPE;
	if (type === "ai" || type === "assistant") return "ai";
	if (type === "system") return "system";
	if (type === "tool") return "tool";
	return "human";
}

function wireLine(message: ChatMessageInput): Line | undefined {
	const text = contentToText(message.content);
	switch (wireType(message.type ?? message.role)) {
		case ENTRY_TYPE:
			return undefined;
		case "human":
			return { kind: "user", text };
		case "ai":
			return { kind: "assistant", text };
		case "tool":
			return { kind: "result", text };
		case "system": {
			const {
				source = UNSOURCED,
				noted,
				failed,
			} = envelopeOf(message.additional_kwargs);
			return {
				kind: "record",
				record: { role: noted ? "system" : "user", content: text, source },
				...(failed ? { failed } : {}),
			};
		}
	}
}

export function wireLines(messages: readonly ChatMessageInput[]): Line[] {
	const lines: Line[] = [];
	for (const message of messages) {
		const line = wireLine(message);
		if (line === undefined) continue;
		const previous = lines.at(-1);
		lines.push(
			line.kind === "result" && previous !== undefined && isPrompt(previous)
				? ranByUser(line.text)
				: line,
		);
	}
	return lines;
}

function replOutcome(content: string): { output: string; error: boolean } {
	try {
		const parsed = JSON.parse(content);
		if (parsed?.type === "tool_result")
			return {
				output: String(parsed.output ?? ""),
				error: Boolean(parsed.error),
			};
	} catch {}
	return { output: content, error: false };
}

export function ranByUser(result: string): Line {
	const { output, error } = replOutcome(result);
	return {
		kind: "record",
		record: {
			role: "user",
			source: "lisp-repl",
			content: [
				error
					? "the user ran the code in their message above, and it failed:"
					: "the user ran the code in their message above:",
				output,
			].join("\n\n"),
		},
	};
}

function transcript(content: string): string {
	const { output, error } = replOutcome(content);
	const shown = output.trimEnd();
	return `${error ? `!! ${shown}` : shown}\n${REPL_PROMPT}`;
}
