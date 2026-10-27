import { topic } from "@repo/interpreter/channels";
import { StepHold } from "@repo/interpreter/errors";
import type { Interp } from "@repo/interpreter/lisp";
import { newSym } from "@repo/interpreter/objects";
import {
	annotating,
	type InterpExtension,
	type SessionHooks,
} from "@repo/interpreter/session";
import { note } from "@repo/interpreter/topics";
import { MemoryImageStore } from "@repo/repl/image-store";
import { AgentRepl } from "@repo/repl/repl";
import type { Repls } from "../src/repl-store.ts";
import {
	type ChatInput,
	streamTurn,
	type TurnStreamOptions,
} from "../src/stream.ts";
import { runAgentTurn, type TurnOptions } from "../src/turn.ts";

export function extension(
	session: (hooks: SessionHooks) => void,
): InterpExtension {
	return Object.assign((_interp: Interp): void => {}, { session });
}

const answersOnForms = extension((hooks) =>
	hooks.answered.use((ctx, out, next) =>
		ctx.code.includes("(") ? next(ctx, out) : true,
	),
);

export function noting(text: string): InterpExtension {
	const skipped = { model: { kind: "skipped" as const, text } };
	return extension((hooks) =>
		hooks.evalStep.use((ctx, next) => {
			note.emit(ctx.interp.channels, skipped);
			return next(ctx);
		}),
	);
}

const reported = topic<string>("reported");

export function reporting(text: string): InterpExtension {
	return extension((hooks) => {
		hooks.evalStep.use((ctx, next) => {
			reported.emit(ctx.interp.channels, { user: text });
			return next(ctx);
		});
		hooks.annotate.use((buffer, into, next) => {
			const seen = buffer.collect(reported);
			return next(
				buffer,
				seen.length === 0 ? into : annotating(into, "step", { reported: seen }),
			);
		});
	});
}

const heard = topic<string>("heard");

export function hearing(text: string): InterpExtension {
	return extension((hooks) => {
		hooks.beginStep.use(function* (ctx, next) {
			heard.emit(ctx.interp.channels, { user: text });
			yield* next(ctx);
		});
		hooks.annotate.use((buffer, into, next) => {
			const seen = buffer.collect(heard);
			return next(
				buffer,
				seen.length === 0 ? into : annotating(into, "step", { heard: seen }),
			);
		});
	});
}

export function riding(text: string): InterpExtension {
	let said = false;
	return extension((hooks) => {
		hooks.beginStep.use(function* (ctx, next) {
			if (!said) ctx.emit(text);
			said = true;
			yield* next(ctx);
		});
	});
}

export function receiving(): InterpExtension {
	return extension((hooks) => {
		hooks.received.use(function* (ctx, received, next) {
			const said = received.said;
			if (typeof said === "string") ctx.emit(`the user also said: ${said}`);
			yield* next(ctx, received);
		});
	});
}

export function testRepl(
	extensions: InterpExtension[] = [],
	images: MemoryImageStore = new MemoryImageStore(),
): AgentRepl {
	return new AgentRepl({ extensions: [answersOnForms, ...extensions], images });
}

class TestRepls implements Repls {
	private readonly opened = new Map<string, AgentRepl>();

	constructor(private readonly extensions: InterpExtension[]) {}

	repl(threadId: string): AgentRepl {
		const standing = this.opened.get(threadId);
		if (standing !== undefined) return standing;
		const opened = testRepl(this.extensions);
		this.opened.set(threadId, opened);
		return opened;
	}

	peek(threadId: string): AgentRepl | undefined {
		return this.opened.get(threadId);
	}
}

export function testRepls(
	extensions: InterpExtension[] = [],
): Repls & { peek(threadId: string): AgentRepl | undefined } {
	return new TestRepls(extensions);
}

const waiting = topic<string>("waiting");

const approved = topic<string>("approved");

const decided = topic<string>("decided");

export function holding(): InterpExtension {
	return Object.assign(
		(interp: Interp) => {
			interp.defineGlobal(
				newSym("wait-for-human"),
				interp.makeBuiltIn("wait-for-human", 0, () => {
					waiting.emit(interp.channels, { user: "approve it" });
					throw new StepHold("approve it");
				}),
			);
		},
		{
			session: (hooks: SessionHooks) => {
				hooks.annotate.use((buffer, into, next) => {
					const seen = buffer.collect(waiting);
					const answers = buffer.collect(decided);
					const asked =
						seen.length === 0
							? into
							: annotating(into, "output", { waiting: seen });
					return next(
						buffer,
						answers.length === 0
							? asked
							: annotating(asked, "output", { decided: answers }),
					);
				});
				hooks.invoke.use(async (ctx, next) => {
					if (ctx.action !== "approve") return next(ctx);
					approved.emit(ctx.interp.channels, { user: "approved, carry on" });
					decided.emit(ctx.interp.channels, { user: "approve" });
				});
				hooks.message.use(
					(buffer, next) => buffer.collect(approved)[0] ?? next(buffer),
				);
			},
		},
	);
}

export type ChatStreamOptions = Omit<TurnOptions, "received"> &
	TurnStreamOptions;

export function streamChat(
	input: ChatInput,
	options: ChatStreamOptions,
): Response {
	const { onTurn, quiet, onOutcome, signal, ...turn } = options;
	return streamTurn(
		input,
		(transcript, received, aborted) =>
			runAgentTurn(transcript, { ...turn, signal: aborted, received }),
		{ signal, onTurn, quiet, onOutcome },
	);
}
