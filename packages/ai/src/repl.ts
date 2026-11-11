import type { Said } from "@repo/interpreter/conversation";
import type { Effect } from "@repo/interpreter/effects";
import type { AgentRepl, EvalOutput, LiveEntries } from "@repo/repl/repl";
import type { Entry } from "@repo/shared/journal";
import type { ChatMessage } from "@repo/shared/messages";
import { neutraliseSystemEvents, renderSystemEvent } from "./system-event.ts";

export interface TranscriptEntry {
	role: "user" | "assistant" | "system" | "tool";
	content: string;
	event?: { source: string };
	source?: string;
}

export function isUserPrompt(entry: TranscriptEntry): boolean {
	return entry.role === "user" && entry.event === undefined;
}

export function said(transcript: readonly TranscriptEntry[]): Said[] {
	return transcript.map((e) =>
		e.event
			? { role: "system", content: e.content }
			: e.source === undefined
				? { role: e.role, content: e.content }
				: { role: e.role, content: e.content, source: e.source },
	);
}

export function noted(note: Said): TranscriptEntry {
	return { role: "system", content: note.content, source: note.source };
}

export function toLlmMessages(transcript: TranscriptEntry[]): ChatMessage[] {
	return transcript.map((e) => ({
		role:
			e.role === "tool" ? "user" : e.role === "system" ? "developer" : e.role,
		content: modelContent(e),
	}));
}

function modelContent(entry: TranscriptEntry): string {
	if (entry.event)
		return renderSystemEvent({
			source: entry.event.source,
			text: entry.content,
		});
	return entry.role === "assistant"
		? entry.content
		: neutraliseSystemEvents(entry.content);
}

export function stripFences(text: string): string {
	const m = text.trim().match(/^```[a-zA-Z]*\n([\s\S]*?)\n?```$/);
	return m ? m[1] : text.trim();
}

export function replResultContent(output: string, error: boolean): string {
	return JSON.stringify({
		type: "tool_result",
		source: "lisp-repl",
		error,
		output: output || "(no output)",
	});
}

async function outcomeOf(
	repl: AgentRepl,
	run: () => Promise<EvalOutput>,
): Promise<{
	output: string;
	display: string;
	error: boolean;
	entries: readonly Entry[];
	effects: readonly Effect[];
	notes: readonly Said[];
	failed: boolean;
	failure: string;
	held: boolean;
	results: readonly string[];
}> {
	try {
		const {
			model,
			user,
			entries,
			effects,
			notes,
			failed,
			failure = "",
			held,
			results,
		} = await run();
		return {
			output: model,
			display: without(user, failure),
			failure,
			error: false,
			entries,
			effects,
			notes,
			failed,
			held,
			results,
		};
	} catch (ex) {
		const restored = await repl.recover();
		const msg = ex instanceof Error ? ex.message : String(ex);
		const text =
			restored === undefined
				? `REPL error: ${msg} (interpreter was reset, definitions lost)`
				: `REPL error: ${msg} (interpreter restored to its last checkpoint, changes since then lost)`;
		return {
			output: text,
			display: "",
			failure: text,
			error: true,
			entries: [],
			effects: [],
			notes: [],
			failed: true,
			held: false,
			results: [],
		};
	}
}

function without(text: string, part: string): string {
	const at = part === "" ? -1 : text.lastIndexOf(part);
	return at < 0 ? text : text.slice(0, at) + text.slice(at + part.length);
}

export function evalCode(
	repl: AgentRepl,
	code: string,
	origin?: string,
	live?: LiveEntries,
) {
	return outcomeOf(repl, () => repl.evalOutput(code, origin, live));
}

export function evalMessageCode(
	repl: AgentRepl,
	code: string,
	origin?: string,
) {
	return outcomeOf(repl, () => repl.evalMessage(code, origin));
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

export function userRanEvent(result: TranscriptEntry): TranscriptEntry {
	const { output, error } = replOutcome(result.content);
	return {
		role: "user",
		content: [
			error
				? "the user ran the code in their message above, and it failed:"
				: "the user ran the code in their message above:",
			output,
		].join("\n\n"),
		event: { source: "lisp-repl" },
	};
}
