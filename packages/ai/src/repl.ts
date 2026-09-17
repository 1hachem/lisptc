import type { FiredMemory } from "@repo/interpreter/memory";
import type { UiNode } from "@repo/interpreter/ui";
import type { AgentRepl } from "@repo/repl/repl";
import type { AgentMessage } from "./agent.ts";

export interface TranscriptEntry {
	role: "user" | "assistant" | "system" | "tool";
	content: string;
}

export function snapshotConversation(
	transcript: TranscriptEntry[],
): Record<string, unknown> {
	return {
		conversation: transcript.map((e) => ({ role: e.role, content: e.content })),
		"user-messages": transcript
			.filter((e) => e.role === "user")
			.map((e) => e.content),
		"assistant-messages": transcript
			.filter((e) => e.role === "assistant")
			.map((e) => e.content),
	};
}

export function toLlmMessages(
	transcript: TranscriptEntry[],
	riding = "",
): AgentMessage[] {
	const messages = transcript.map((e) => ({
		role: e.role === "tool" ? "user" : e.role,
		content: e.content,
	}));
	if (riding === "") return messages;
	let last = -1;
	for (let i = transcript.length - 1; i >= 0; i--)
		if (transcript[i].role === "user") {
			last = i;
			break;
		}
	if (last === -1) return messages;
	const carried = messages[last];
	messages[last] = {
		...carried,
		content: `${carried.content}\n\n${riding}`,
	};
	return messages;
}

export function stripFences(text: string): string {
	const m = text.trim().match(/^```[a-zA-Z]*\n([\s\S]*?)\n?```$/);
	return m ? m[1] : text.trim();
}

export function replResultContent(
	output: string,
	error: boolean,
	memories: FiredMemory[] = [],
): string {
	return JSON.stringify({
		type: "tool_result",
		source: "lisp-repl",
		error,
		output: output || "(no output)",
		...(memories.length > 0 ? { memories } : {}),
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

export async function evalCode(
	repl: AgentRepl,
	code: string,
): Promise<{
	output: string;
	display: string;
	error: boolean;
	memories: FiredMemory[];
	failed: boolean;
	ui?: UiNode;
}> {
	try {
		const { model, user, memories, failed, ui } = await repl.evalOutput(code);
		return { output: model, display: user, error: false, memories, failed, ui };
	} catch (ex) {
		repl.reset();
		const msg = ex instanceof Error ? ex.message : String(ex);
		const text = `REPL error: ${msg} (interpreter was reset, definitions lost)`;
		return {
			output: text,
			display: text,
			error: true,
			memories: [],
			failed: true,
		};
	}
}
