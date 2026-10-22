import { topic } from "@repo/interpreter/channels";
import { effect } from "@repo/interpreter/effects";
import type { Interp } from "@repo/interpreter/lisp";
import {
	annotating,
	type InterpExtension,
	type SessionHooks,
} from "@repo/interpreter/session";
import { note, output } from "@repo/interpreter/topics";
import { MemoryImageStore } from "@repo/repl/image-store";
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
	return new AgentRepl({ extensions: [answering(), ...extensions], images });
}

export function testRepls(extensions: InterpExtension[] = []): ReplStore {
	return new ReplStore(() => testRepl(extensions));
}

const asked = topic<string>("asked");

export function asking(question: string): InterpExtension {
	return extension((hooks) => {
		hooks.evalStep.use((ctx, next) => {
			asked.emit(ctx.interp.channels, { user: question });
			effect.emit(ctx.interp.channels, { harness: { type: "end" } });
			return next(ctx);
		});
		hooks.annotate.use((buffer, into, next) => {
			const seen = buffer.collect(asked);
			return next(
				buffer,
				seen.length === 0 ? into : annotating(into, "output", { asked: seen }),
			);
		});
	});
}

const closing = topic<string>("closing");

export function concluding(text: string): InterpExtension {
	return extension((hooks) => {
		hooks.beforeSettle.use(function* (ctx, more, next) {
			const decided = yield* next(ctx, more);
			if (!decided) closing.emit(ctx.interp.channels, { user: text });
			return decided;
		});
		hooks.annotate.use((buffer, into, next) => {
			const seen = buffer.collect(closing);
			return next(
				buffer,
				seen.length === 0 ? into : annotating(into, "output", { closed: seen }),
			);
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
