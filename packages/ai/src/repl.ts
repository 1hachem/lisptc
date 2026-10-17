import { noAnnotations, type StepAnnotations } from "@repo/interpreter/session";
import type { AgentRepl, EvalOutput } from "@repo/repl/repl";
import type { AgentMessage } from "./agent.ts";
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

export function snapshotConversation(
	transcript: TranscriptEntry[],
): Record<string, unknown> {
	return {
		conversation: transcript.map((e) => ({
			role: e.event ? "system" : e.role,
			content: e.content,
		})),
		"user-messages": transcript.filter(isUserPrompt).map((e) => e.content),
		"assistant-messages": transcript
			.filter((e) => e.role === "assistant")
			.map((e) => e.content),
	};
}

export function joinRiding(standing: string | undefined, text: string): string {
	return standing === undefined || standing === ""
		? text
		: `${standing}\n\n${text}`;
}

export function toLlmMessages(transcript: TranscriptEntry[]): AgentMessage[] {
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
	emitted: string;
	failed: boolean;
	held: boolean;
	results: readonly string[];
}> {
	try {
		const { model, user, annotations, emitted, failed, held, results } =
			await run();
		return {
			output: model,
			display: user,
			error: false,
			annotations,
			emitted,
			failed,
			held,
			results,
		};
	} catch (ex) {
		repl.reset();
		const msg = ex instanceof Error ? ex.message : String(ex);
		const text = `REPL error: ${msg} (interpreter was reset, definitions lost)`;
		return {
			output: text,
			display: text,
			error: true,
			annotations: noAnnotations(),
			emitted: "",
			failed: true,
			held: false,
			results: [],
		};
	}
}

export function evalCode(repl: AgentRepl, code: string) {
	return outcomeOf(repl, () => repl.evalOutput(code));
}

export function evalMessageCode(repl: AgentRepl, code: string) {
	return outcomeOf(repl, () => repl.evalMessage(code));
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

function userRanEvent(result: TranscriptEntry): TranscriptEntry {
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

export function withItsResult(
	prompt: TranscriptEntry,
	result: TranscriptEntry,
): [TranscriptEntry, TranscriptEntry] {
	const ran = userRanEvent(result);
	if (result.riding === undefined) return [prompt, ran];
	return [{ ...prompt, riding: joinRiding(prompt.riding, result.riding) }, ran];
}
