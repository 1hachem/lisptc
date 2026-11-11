import { type Channels, topic } from "@repo/interpreter/channels";
import { effect } from "@repo/interpreter/effects";
import { StepHold } from "@repo/interpreter/errors";
import { journal } from "@repo/interpreter/journal";
import type { Interp } from "@repo/interpreter/lisp";
import { newSym } from "@repo/interpreter/objects";
import type { InterpExtension, SessionHooks } from "@repo/interpreter/session";
import { output } from "@repo/interpreter/topics";
import { systemPromptKind } from "@repo/journal-catalog/system";
import { MemoryImageStore } from "@repo/repl/image-store";
import { AgentRepl } from "@repo/repl/repl";
import type { Repls } from "../src/repl-store.ts";
import {
	type ChatInput,
	streamTurn,
	type TurnStreamOptions,
} from "../src/stream.ts";
import { runAgentTurn, type TurnOptions } from "../src/turn.ts";

let recorded = 0;

export function recording(
	channels: Channels | undefined,
	kind: string,
	value: unknown,
	supersedes?: true,
): void {
	recorded += 1;
	journal.emit(channels, {
		harness: {
			id: `t${recorded}`,
			kind,
			value,
			...(supersedes ? { supersedes } : {}),
		},
	});
}

export function extension(
	session: (hooks: SessionHooks) => void,
): InterpExtension {
	return Object.assign((_interp: Interp): void => {}, { session });
}

const answersOnForms = extension((hooks) =>
	hooks.evalStep.use((ctx, next) => {
		if (!ctx.code.includes("("))
			effect.emit(ctx.interp.channels, { harness: { type: "end" } });
		return next(ctx);
	}),
);

export function reporting(text: string): InterpExtension {
	return extension((hooks) => {
		hooks.evalStep.use((ctx, next) => {
			recording(ctx.interp.channels, "reported", text);
			return next(ctx);
		});
	});
}

export function hearing(text: string): InterpExtension {
	return extension((hooks) => {
		hooks.beginStep.use(function* (ctx, next) {
			recording(ctx.interp.channels, "heard", text);
			yield* next(ctx);
		});
	});
}

export function telling(text: string): InterpExtension {
	let said = false;
	return extension((hooks) => {
		hooks.beginStep.use(function* (ctx, next) {
			if (!said) ctx.interp.conversation.append("test", text);
			said = true;
			yield* next(ctx);
		});
	});
}

export function receiving(): InterpExtension {
	return extension((hooks) => {
		hooks.received.use(function* (ctx, received, next) {
			const said = received.said;
			if (typeof said === "string")
				ctx.interp.conversation.append("test", `the user also said: ${said}`);
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

const approved = topic<string>("approved");

export function holding(): InterpExtension {
	return Object.assign(
		(interp: Interp) => {
			interp.defineGlobal(
				newSym("wait-for-human"),
				interp.makeBuiltIn("wait-for-human", 0, () => {
					recording(interp.channels, "waiting", "approve it");
					throw new StepHold("approve it");
				}),
			);
		},
		{
			session: (hooks: SessionHooks) => {
				hooks.invoke.use(async (ctx, next) => {
					if (ctx.action !== "approve") return next(ctx);
					approved.emit(ctx.interp.channels, { user: "approved, carry on" });
					recording(ctx.interp.channels, "decided", "approve");
				});
				hooks.message.use(
					(buffer, next) => buffer.collect(approved)[0] ?? next(buffer),
				);
			},
		},
	);
}

export function approvingByNote(): InterpExtension {
	return extension((hooks) =>
		hooks.invoke.use(async (ctx, next) => {
			if (ctx.action !== "approve") return next(ctx);
			ctx.interp.conversation.append("approver", "approved, carry on");
		}),
	);
}

export type ChatStreamOptions = Omit<TurnOptions, "received"> &
	TurnStreamOptions;

export function streamChat(
	input: ChatInput,
	options: ChatStreamOptions,
): Response {
	const { onStep, onTurn, quiet, onOutcome, signal, ...turn } = options;
	return streamTurn(
		input,
		(transcript, received, aborted) =>
			runAgentTurn(transcript, { ...turn, signal: aborted, received }),
		{ signal, onStep, onTurn, quiet, onOutcome },
	);
}

export function asking(question: string): InterpExtension {
	return extension((hooks) => {
		hooks.evalStep.use((ctx, next) => {
			recording(ctx.interp.channels, "asked", question);
			effect.emit(ctx.interp.channels, { harness: { type: "end" } });
			return next(ctx);
		});
	});
}

export function concluding(text: string): InterpExtension {
	return extension((hooks) => {
		hooks.beforeSettle.use(function* (ctx, more, next) {
			const decided = yield* next(ctx, more);
			if (!decided) recording(ctx.interp.channels, "closed", text);
			return decided;
		});
	});
}

export function printing(text: string): InterpExtension {
	return extension((hooks) =>
		hooks.evalStep.use((ctx, next) => {
			output.emit(ctx.interp.channels, { user: text, model: text });
			return next(ctx);
		}),
	);
}

export function unprompted<
	T extends { additional_kwargs?: Record<string, unknown> },
>(messages: readonly T[]): T[] {
	return messages.filter(
		(m) => m.additional_kwargs?.kind !== systemPromptKind.name,
	);
}
