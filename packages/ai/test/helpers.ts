import type { Interp, InterpExtension } from "@repo/interpreter/lisp";
import type { SessionHooks } from "@repo/interpreter/session";
import { note } from "@repo/interpreter/topics";
import { AgentRepl } from "@repo/repl/repl";
import { ReplStore } from "../src/repl-store.ts";

export function extension(
	session: (hooks: SessionHooks) => void,
): InterpExtension {
	return Object.assign((_interp: Interp): void => {}, { session });
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

export function testRepl(extensions: InterpExtension[] = []): AgentRepl {
	return new AgentRepl({ extensions: [answering(), ...extensions] });
}

export function testRepls(extensions: InterpExtension[] = []): ReplStore {
	return new ReplStore(() => testRepl(extensions));
}
