import {
	type ChatMessage,
	isSystemMessage,
	isToolMessage,
	isUserMessage,
	stepMeta,
	toolActivity,
	tracePlacement,
} from "./chat.tsx";
import { foldEntries, isEntryMessage } from "./entries.ts";

export interface TraceChild {
	chatId: string;
	label: string;
	after: number;
}

export interface TraceStep {
	id: string;
	number: number;
	messages: ChatMessage[];
	children: TraceChild[];
	durationMs?: number;
}

export type TraceEntry =
	| { kind: "message"; message: ChatMessage; at: number }
	| { kind: "step"; step: TraceStep };

function durationOf(messages: readonly ChatMessage[]): number | undefined {
	const timed = messages
		.map((m) => stepMeta(m)?.durationMs)
		.filter((ms): ms is number => ms !== undefined);
	return timed.length === 0 ? undefined : timed.reduce((a, b) => a + b, 0);
}

function childrenOf(messages: readonly ChatMessage[]): TraceChild[] {
	const children = new Map<string, TraceChild>();
	for (const [after, message] of messages.entries())
		if (isToolMessage(message))
			for (const { chat, label } of toolActivity(message))
				if (chat !== undefined && !children.has(chat))
					children.set(chat, { chatId: chat, label, after });
	return [...children.values()];
}

function stepOf(messages: ChatMessage[], number: number): TraceStep {
	return {
		id: messages[0]?.id ?? `step:${number}`,
		number,
		messages,
		children: childrenOf(messages),
		durationMs: durationOf(messages),
	};
}

export function traceEntries(messages: readonly ChatMessage[]): TraceEntry[] {
	const entries: TraceEntry[] = [];
	let open: ChatMessage[] | undefined;
	let waiting: ChatMessage[] = [];
	let steps = 0;
	const close = () => {
		if (open === undefined) return;
		steps += 1;
		entries.push({ kind: "step", step: stepOf(open, steps) });
		open = undefined;
	};
	const settle = () => {
		if (open !== undefined) open.push(...waiting);
		else if (waiting.length > 0) open = waiting;
		waiting = [];
	};
	for (const [at, message] of foldEntries(messages, tracePlacement).entries()) {
		if (isEntryMessage(message)) {
			waiting.push(message);
		} else if (isUserMessage(message) || isSystemMessage(message)) {
			settle();
			close();
			entries.push({ kind: "message", message, at });
		} else if (isToolMessage(message) && open !== undefined) {
			open.push(...waiting, message);
			waiting = [];
		} else {
			close();
			open = [...waiting, message];
			waiting = [];
		}
	}
	settle();
	close();
	return entries;
}
