/**
 * REPL glue for the streaming agent loop.
 *
 * The AI agent is grammar-constrained so every reply IS a Lisptc program. This
 * module drives the "output text → eval → feed result back" loop against the
 * embeddable `AgentRepl` (`@repo/repl`), the same binding the pi extension uses
 * in-process. `stream.ts` owns the SSE framing; these helpers own everything
 * about talking to the REPL: the conversation snapshot injected each step, the
 * fence-stripping, and the JSON tool-result the policy tells the model to read.
 */

import type { AgentRepl } from "@repo/repl/repl.ts";
import type { AgentMessage } from "./agent.ts";

// One turn of the running transcript. Distinct from `AgentMessage` because a
// REPL result is its own `tool` role here (so it never pollutes `user-messages`)
// even though it is fed to the model as a user turn.
export interface TranscriptEntry {
	role: "user" | "assistant" | "system" | "tool";
	content: string;
}

// The read-only conversation globals refreshed before every eval, mirroring the
// pi extension: the full ordered transcript plus the real user/assistant text.
// REPL results appear in `conversation` under the `tool` role but are excluded
// from `user-messages`/`assistant-messages`.
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

// The history handed to the model. A `tool` result is projected as a user turn
// (the model reads it as the REPL speaking, per the policy) since the chat model
// only knows user/assistant/system roles.
export function toLlmMessages(transcript: TranscriptEntry[]): AgentMessage[] {
	return transcript.map((e) => ({
		role: e.role === "tool" ? "user" : e.role,
		content: e.content,
	}));
}

// Occasionally the model wraps its code in a markdown fence despite the policy;
// unwrap it so the REPL sees bare Lisp.
export function stripFences(text: string): string {
	const m = text.trim().match(/^```[a-zA-Z]*\n([\s\S]*?)\n?```$/);
	return m ? m[1] : text.trim();
}

// The result fed back to the model. A JSON tool-result object (matching the
// policy) rather than bare text, so the model never mistakes REPL output for a
// human message.
export function replResultContent(output: string, error: boolean): string {
	return JSON.stringify({
		type: "tool_result",
		source: "lisp-repl",
		error,
		output: output || "(no output)",
	});
}

/*
 * Evaluate one program.
 *
 * `output` is the capped text fed back to the model; `display` is the same
 * output unbounded, for the human reading the transcript. A thrown error means
 * an unexpected host error (the REPL renders Lisp errors into its output rather
 * than throwing), so reset the interpreter to avoid persisting corrupt state.
 */
export function evalCode(
	repl: AgentRepl,
	code: string,
): { output: string; display: string; error: boolean } {
	try {
		const { model, user } = repl.evalOutput(code);
		return { output: model, display: user, error: false };
	} catch (ex) {
		repl.reset();
		const msg = ex instanceof Error ? ex.message : String(ex);
		const text = `REPL error: ${msg} (interpreter was reset, definitions lost)`;
		return { output: text, display: text, error: true };
	}
}
