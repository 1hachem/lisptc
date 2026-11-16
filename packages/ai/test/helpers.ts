import { effect } from "@repo/interpreter/effects";
import { StepHold } from "@repo/interpreter/errors";
import { type Journal, print } from "@repo/interpreter/journal";
import type { Interp } from "@repo/interpreter/lisp";
import { newSym } from "@repo/interpreter/objects";
import type { InterpExtension, SessionHooks } from "@repo/interpreter/session";
import { MemoryImageStore } from "@repo/repl/image-store";
import { AgentRepl } from "@repo/repl/repl";
import { entryKind, every, latestOnly } from "@repo/shared/journal";
import { z } from "zod";
import type { Repls } from "../src/repl-store.ts";
import {
	type ChatInput,
	streamTurn,
	type TurnStreamOptions,
} from "../src/stream.ts";
import { runAgentTurn, type TurnOptions } from "../src/turn.ts";

export function recording(
	journal: Journal | undefined,
	name: string,
	value: unknown,
	supersedes?: true,
): void {
	const schema = z.unknown();
	journal?.write(
		supersedes
			? latestOnly({ name, schema })
			: entryKind({ name, schema, fold: every }),
		value,
	);
}

export function extension(
	session: (hooks: SessionHooks) => void,
): InterpExtension {
	return Object.assign((_interp: Interp): void => {}, { session });
}

const answersOnForms = extension((hooks) =>
	hooks.evalStep.use((ctx, next) => {
		if (!ctx.code.includes("("))
			ctx.interp.journal.write(effect, { type: "end" });
		return next(ctx);
	}),
);

export function reporting(text: string): InterpExtension {
	return extension((hooks) => {
		hooks.evalStep.use((ctx, next) => {
			recording(ctx.interp.journal, "reported", text);
			return next(ctx);
		});
	});
}

export function hearing(text: string): InterpExtension {
	return extension((hooks) => {
		hooks.beginStep.use(function* (ctx, next) {
			recording(ctx.interp.journal, "heard", text);
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

export function holding(): InterpExtension {
	return Object.assign(
		(interp: Interp) => {
			interp.defineGlobal(
				newSym("wait-for-human"),
				interp.makeBuiltIn("wait-for-human", 0, () => {
					recording(interp.journal, "waiting", "approve it");
					throw new StepHold("approve it");
				}),
			);
		},
		{
			session: (hooks: SessionHooks) => {
				hooks.invoke.use(async (ctx, next) => {
					if (ctx.action !== "approve") return next(ctx);
					ctx.interp.conversation.request(ctx.action, "approved, carry on");
					recording(ctx.interp.journal, "decided", "approve");
				});
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

export function refusingByNote(): InterpExtension {
	return extension((hooks) =>
		hooks.invoke.use(async (ctx, next) => {
			ctx.interp.conversation.append("refuser", "refused, try another way");
			return next(ctx);
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
		(lines, received, aborted) =>
			runAgentTurn(lines, { ...turn, signal: aborted, received }),
		{ signal, onStep, onTurn, quiet, onOutcome },
	);
}

export function asking(question: string): InterpExtension {
	return extension((hooks) => {
		hooks.evalStep.use((ctx, next) => {
			recording(ctx.interp.journal, "asked", question);
			ctx.interp.journal.write(effect, { type: "end" });
			return next(ctx);
		});
	});
}

export function concluding(text: string): InterpExtension {
	return extension((hooks) => {
		hooks.beforeSettle.use(function* (ctx, more, next) {
			const decided = yield* next(ctx, more);
			if (!decided) recording(ctx.interp.journal, "closed", text);
			return decided;
		});
	});
}

export function printing(text: string): InterpExtension {
	return extension((hooks) =>
		hooks.evalStep.use((ctx, next) => {
			print(ctx.interp.journal, { user: text, model: text });
			return next(ctx);
		}),
	);
}
