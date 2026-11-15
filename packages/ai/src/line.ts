import type { Said } from "@repo/interpreter/conversation";
import { ENTRY_TYPE } from "@repo/shared/journal";
import {
	type ChatMessage,
	contentToText,
	envelopeOf,
	type MessageKwargs,
} from "@repo/shared/messages";
import type { Envelope } from "./mailbox.ts";
import { neutraliseSystemEvents, renderSystemEvent } from "./system-event.ts";

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

export interface NoteLine {
	readonly kind: "note";
	readonly source: string;
	readonly text: string;
}

interface EventLine {
	readonly kind: "event";
	readonly source: string;
	readonly text: string;
	readonly failed?: true;
}

interface SpokenLine {
	readonly kind: "user" | "assistant" | "result";
	readonly text: string;
}

export type Line = SpokenLine | EventLine | NoteLine;

export type PostedLine =
	| (SpokenLine & { readonly kind: "user" })
	| EventLine
	| NoteLine;

const UNSOURCED = "system";

export function isPrompt(line: Line): boolean {
	return line.kind === "user";
}

export function noteLine(said: Said): NoteLine {
	return {
		kind: "note",
		source: said.source ?? UNSOURCED,
		text: said.content,
	};
}

export function envelopeLine(envelope: Envelope): PostedLine {
	if (envelope.kind === "user") return { kind: "user", text: envelope.text };
	const { source, text } = envelope;
	if (envelope.noted) return { kind: "note", source, text };
	return {
		kind: "event",
		source,
		text,
		...(envelope.failed ? { failed: true as const } : {}),
	};
}

export function lineSaid(line: Line): Said {
	switch (line.kind) {
		case "user":
		case "assistant":
			return { role: line.kind, content: line.text };
		case "result":
			return { role: "tool", content: line.text };
		case "event":
		case "note":
			return { role: "system", content: line.text, source: line.source };
	}
}

export function lineChat(line: Line): ChatMessage {
	switch (line.kind) {
		case "assistant":
			return { role: "assistant", content: line.text };
		case "user":
		case "result":
			return { role: "user", content: neutraliseSystemEvents(line.text) };
		case "event":
			return { role: "user", content: renderSystemEvent(line) };
		case "note":
			return { role: "developer", content: neutraliseSystemEvents(line.text) };
	}
}

export function lineWire(line: PostedLine, id: string): WireMessage {
	if (line.kind === "user") return { type: "human", content: line.text, id };
	return {
		type: "system",
		content: line.text,
		id,
		additional_kwargs: {
			source: line.source,
			...(line.kind === "event" && line.failed ? { failed: true } : {}),
			...(line.kind === "note" ? { noted: true } : {}),
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
			return envelopeOf(message.additional_kwargs).quiet === true
				? undefined
				: { kind: "result", text };
		case "system": {
			const {
				source = UNSOURCED,
				noted,
				failed,
			} = envelopeOf(message.additional_kwargs);
			if (noted) return { kind: "note", source, text };
			return { kind: "event", source, text, ...(failed ? { failed } : {}) };
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
		kind: "event",
		source: "lisp-repl",
		text: [
			error
				? "the user ran the code in their message above, and it failed:"
				: "the user ran the code in their message above:",
			output,
		].join("\n\n"),
	};
}
