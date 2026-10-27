import type { Effect } from "@repo/interpreter/effects";
import {
	noAnnotations,
	type Problem,
	type StepAnnotations,
} from "@repo/interpreter/session";
import type { AgentRepl, EvalOutput, LiveAnnotations } from "@repo/repl/repl";
import type { ChatMessage } from "@repo/shared/messages";
import { neutraliseSystemEvents, renderSystemEvent } from "./system-event.ts";

export interface TranscriptEntry {
	role: "user" | "assistant" | "system" | "tool";
	content: string;
	event?: { source: string };
	riding?: string;
}

export function isUserPrompt(entry: TranscriptEntry): boolean {
	return entry.role === "user" && entry.event === undefined;
}

export function joinRiding(standing: string | undefined, text: string): string {
	return standing === undefined || standing === ""
		? text
		: `${standing}\n\n${text}`;
}

export function toLlmMessages(transcript: TranscriptEntry[]): ChatMessage[] {
	return transcript.map((e) => ({
		role: e.role === "tool" ? "user" : e.role,
		content: e.riding
			? joinRiding(modelContent(e), neutraliseSystemEvents(e.riding))
			: modelContent(e),
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

export function checkResultContent(
	output: string,
	problems: readonly Problem[] = [],
): string {
	return JSON.stringify({
		type: "tool_result",
		source: "lisp-check",
		error: true,
		output,
		...(problems.length > 0 ? { problems } : {}),
	});
}

export function proseFeedbackContent(feedback: string): string {
	return replResultContent(
		[
			"your previous reply ran nothing — a parenthesis in prose is read as prose:",
			feedback.trimEnd(),
			"put parentheses only around code you mean to run.",
			"this note is private: it is not from the user and the user cannot see it. Do not mention it, apologise for it, or explain it — just answer the user's message without repeating that shape.",
		].join("\n"),
		false,
	);
}

async function outcomeOf(
	repl: AgentRepl,
	run: () => Promise<EvalOutput>,
): Promise<{
	output: string;
	display: string;
	error: boolean;
	annotations: StepAnnotations;
	effects: readonly Effect[];
	emitted: string;
	failed: boolean;
	failure: string;
	held: boolean;
	results: readonly string[];
}> {
	try {
		const {
			model,
			user,
			annotations,
			effects,
			emitted,
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
			annotations,
			effects,
			emitted,
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
			annotations: noAnnotations(),
			effects: [],
			emitted: "",
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
	live?: LiveAnnotations,
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

function replOutcome(content: string): {
	output: string;
	error: boolean;
	stopped: boolean;
} {
	try {
		const parsed = JSON.parse(content);
		if (parsed?.type === "tool_result")
			return {
				output: String(parsed.output ?? ""),
				error: Boolean(parsed.error),
				stopped: parsed.source === "lisp-check",
			};
	} catch {}
	return { output: content, error: false, stopped: false };
}

function ranHeading(error: boolean, stopped: boolean): string {
	if (stopped)
		return "the user ran the code in their message above, and it was stopped before it ran:";
	return error
		? "the user ran the code in their message above, and it failed:"
		: "the user ran the code in their message above:";
}

function userRanEvent(result: TranscriptEntry): TranscriptEntry {
	const { output, error, stopped } = replOutcome(result.content);
	return {
		role: "user",
		content: [ranHeading(error, stopped), output].join("\n\n"),
		event: { source: "lisp-repl" },
	};
}

export function withItsResult(
	prompt: TranscriptEntry,
	result: TranscriptEntry,
): [TranscriptEntry, TranscriptEntry] {
	const ran = userRanEvent(result);
	if (result.riding === undefined) return [prompt, ran];
	return [{ ...prompt, riding: joinRiding(prompt.riding, result.riding) }, ran];
}
