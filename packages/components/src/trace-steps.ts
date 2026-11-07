import { systemPromptKind } from "@repo/journal-catalog/system";
import { view } from "@repo/shared/journal";
import {
	entriesOfMessage,
	foldEntries,
	isEntryMessage,
	toolActivity,
	tracePlacement,
} from "./trace-entries.ts";
import {
	type ChatMessage,
	isSystemMessage,
	isToolMessage,
	isUserMessage,
	type StepMeta,
	stepMeta,
} from "./trace-message.ts";

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
	meta?: StepMeta;
}

export type TraceEntry =
	| { kind: "message"; message: ChatMessage; at: number }
	| { kind: "prompt"; message: ChatMessage; text: string; at: number }
	| { kind: "step"; step: TraceStep };

function promptOf(message: ChatMessage): string | undefined {
	return view(entriesOfMessage(message), systemPromptKind).at(-1)?.text;
}

function sum(values: (number | undefined)[]): number | undefined {
	const known = values.filter((n): n is number => n !== undefined);
	return known.length === 0 ? undefined : known.reduce((a, b) => a + b, 0);
}

function metaOf(messages: readonly ChatMessage[]): StepMeta | undefined {
	const metas = messages
		.map((m) => stepMeta(m))
		.filter((meta): meta is StepMeta => meta !== undefined);
	if (metas.length === 0) return undefined;
	return {
		at: metas[0]?.at,
		durationMs: sum(metas.map((m) => m.durationMs)),
		inputTokens: sum(metas.map((m) => m.inputTokens)),
		cachedInputTokens: sum(metas.map((m) => m.cachedInputTokens)),
		outputTokens: sum(metas.map((m) => m.outputTokens)),
	};
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
		meta: metaOf(messages),
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
	let prompted: string | undefined;
	const prompt = (message: ChatMessage, text: string, at: number) => {
		if (text === prompted) return;
		prompted = text;
		const row: TraceEntry = { kind: "prompt", message, text, at };
		const opening = entries.at(-1);
		if (
			open === undefined &&
			waiting.length === 0 &&
			opening?.kind === "message"
		)
			entries.splice(entries.length - 1, 0, row);
		else {
			settle();
			close();
			entries.push(row);
		}
	};
	const settle = () => {
		if (open !== undefined) open.push(...waiting);
		else if (waiting.length > 0) open = waiting;
		waiting = [];
	};
	for (const [at, message] of foldEntries(messages, tracePlacement).entries()) {
		const text = promptOf(message);
		if (text !== undefined) {
			prompt(message, text, at);
		} else if (isEntryMessage(message)) {
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
