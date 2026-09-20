import type { Interp, InterpExtension } from "@repo/interpreter/lisp";
import { llmSlot, type Observed } from "@repo/interpreter/observe";
import type { SessionHooks } from "@repo/interpreter/session";
import { note } from "@repo/interpreter/topics";
import { AgentRepl, MemoryRepl } from "../src/repl.ts";

export function extension(
	session: (hooks: SessionHooks) => void,
): InterpExtension {
	return Object.assign((_interp: Interp): void => {}, { session });
}

export function observedExtension(): InterpExtension {
	const observed: Observed = {};
	return extension((hooks) => hooks.fill(llmSlot, observed));
}

export function answering(): InterpExtension {
	return extension((hooks) =>
		hooks.answered.use((ctx, out, next) =>
			ctx.code.includes("(") ? next(ctx, out) : true,
		),
	);
}

export function noting(text: string): InterpExtension {
	return extension((hooks) =>
		hooks.evalStep.use((ctx, next) => {
			note.emit(ctx.interp.channels, { model: { kind: "skipped", text } });
			return next(ctx);
		}),
	);
}

export function memoryRepl(extensions: InterpExtension[] = []): MemoryRepl {
	return new MemoryRepl({ extensions });
}

export function agentRepl(extensions: InterpExtension[] = []): AgentRepl {
	return new AgentRepl({ extensions });
}
