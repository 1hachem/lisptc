import { formsIn } from "@repo/syntax";
import {
	type ChatMessage,
	isSystemMessage,
	isToolMessage,
	isUserMessage,
	messageProse,
	messageText,
	stepMeta,
	toolFailed,
} from "./chat.tsx";

const COLLAPSED_FROM = 8;

const SNIPPET = 60;

export interface TraceStep {
	id: string;
	number: number;
	messages: ChatMessage[];
	title: string;
	failed: boolean;
	durationMs?: number;
}

export type TraceEntry =
	| { kind: "message"; message: ChatMessage; at: number }
	| { kind: "step"; step: TraceStep };

function snippet(text: string): string {
	const line = text.trim().split("\n")[0] ?? "";
	return line.length > SNIPPET ? `${line.slice(0, SNIPPET)}…` : line;
}

function titleOf(messages: readonly ChatMessage[]): string {
	const lead = messages.find((m) => !isToolMessage(m));
	if (lead === undefined) return "tool result";
	const text = messageText(lead);
	const { prose, heads } = formsIn(
		text,
		messageProse(lead).map((s) => s.span),
	);
	const head = heads[0];
	return head === undefined ? snippet(prose) || "step" : `(${head})`;
}

function durationOf(messages: readonly ChatMessage[]): number | undefined {
	const timed = messages
		.map((m) => stepMeta(m)?.durationMs)
		.filter((ms): ms is number => ms !== undefined);
	return timed.length === 0 ? undefined : timed.reduce((a, b) => a + b, 0);
}

function stepOf(messages: ChatMessage[], number: number): TraceStep {
	return {
		id: messages[0]?.id ?? `step:${number}`,
		number,
		messages,
		title: titleOf(messages),
		failed: messages.some((m) => isToolMessage(m) && toolFailed(m)),
		durationMs: durationOf(messages),
	};
}

export function traceEntries(messages: readonly ChatMessage[]): TraceEntry[] {
	const entries: TraceEntry[] = [];
	let open: ChatMessage[] | undefined;
	let steps = 0;
	const close = () => {
		if (open === undefined) return;
		steps += 1;
		entries.push({ kind: "step", step: stepOf(open, steps) });
		open = undefined;
	};
	for (const [at, message] of messages.entries()) {
		if (isUserMessage(message) || isSystemMessage(message)) {
			close();
			entries.push({ kind: "message", message, at });
		} else if (isToolMessage(message) && open !== undefined) {
			open.push(message);
		} else {
			close();
			open = [message];
		}
	}
	close();
	return entries;
}

export function stepHolding(
	entries: readonly TraceEntry[],
	message: string | undefined,
): string | undefined {
	if (message === undefined) return undefined;
	for (const entry of entries)
		if (
			entry.kind === "step" &&
			entry.step.messages.some((m) => m.id === message)
		)
			return entry.step.id;
	return undefined;
}

export function collapsedByDefault(entries: readonly TraceEntry[]): boolean {
	return entries.filter((e) => e.kind === "step").length >= COLLAPSED_FROM;
}
