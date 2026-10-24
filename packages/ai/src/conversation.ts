import type { StepAnnotations } from "@repo/interpreter/session";
import type { AgentRepl } from "@repo/repl/repl";
import type { AgentConfig } from "./agent.ts";
import { systemPromptFor } from "./prompts/lisp.ts";
import { replResultContent, type TranscriptEntry } from "./repl.ts";
import { runAgentTurn } from "./turn.ts";

export class ConversationStopped extends Error {}

export interface Reply {
	readonly maxSteps: number;
	readonly signal: AbortSignal;
}

export type Replied =
	| { readonly answer: string }
	| { readonly held: StepAnnotations };

export class Conversation {
	private readonly transcript: TranscriptEntry[];

	constructor(
		private readonly repl: AgentRepl,
		private readonly instructions: string,
		private readonly config: () => Promise<AgentConfig>,
		history: readonly TranscriptEntry[] = [],
	) {
		this.transcript = [...history];
	}

	async reply(message: string, { maxSteps, signal }: Reply): Promise<Replied> {
		const config = await this.config();
		this.transcript.push({ role: "user", content: message });
		let held: StepAnnotations | undefined;
		for await (const event of runAgentTurn(this.transcript, {
			repl: this.repl,
			maxSteps,
			signal,
			config: {
				...config,
				system: `${systemPromptFor(this.repl.interp)}\n\n${this.instructions}`,
			},
		})) {
			if (event.type === "result" && event.held) held = event.annotations;
			if (event.type === "assistant")
				this.transcript.push({ role: "assistant", content: event.code });
			if (event.type === "result")
				this.transcript.push({
					role: "tool",
					content: replResultContent(event.output, event.error),
				});
			if (event.type === "halt")
				return held === undefined ? { answer: event.answer } : { held };
			if (event.type === "capped")
				throw new ConversationStopped(
					`used its ${event.steps} steps without answering`,
				);
			if (event.type === "silent")
				throw new ConversationStopped("replied with nothing");
			if (event.type === "failed")
				throw new ConversationStopped(`failed: ${event.message}`);
		}
		throw new ConversationStopped("stopped without answering");
	}
}
