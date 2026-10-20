import {
	type ConversationEntry,
	conversationSlot,
} from "@repo/interpreter/conversation";
import { settled } from "@repo/interpreter/drive";
import type { Interp } from "@repo/interpreter/lisp";
import { jsonToLisp, newSym } from "@repo/interpreter/objects";
import type {
	InterpExtension,
	Problem,
	SessionHooks,
} from "@repo/interpreter/session";
import type { Awaitable, PromptSource } from "@repo/shared/host";

export interface ConversationStore {
	stored(): Awaitable<readonly ConversationEntry[]>;
}

export interface ConversationHost {
	prompt: PromptSource;
	store: ConversationStore;
}

const VARIABLE_DOC =
	"Read-only live conversation state, refreshed before every step.";

export function conversationVariables(
	entries: readonly ConversationEntry[],
): Record<string, unknown> {
	return {
		conversation: entries,
		"user-messages": entries
			.filter((e) => e.role === "user")
			.map((e) => e.content),
		"assistant-messages": entries
			.filter((e) => e.role === "assistant")
			.map((e) => e.content),
	};
}

function define(interp: Interp, entries: readonly ConversationEntry[]): void {
	for (const [name, value] of Object.entries(conversationVariables(entries)))
		interp.defineGlobal(newSym(name), jsonToLisp(value), {
			signature: name,
			doc: VARIABLE_DOC,
		});
}

interface Admitted {
	code: string;
	problems?: readonly Problem[];
}

class Conversation {
	private stored: readonly ConversationEntry[] = [];
	private live: ConversationEntry[] = [];
	private pending: Admitted | undefined;

	entries(): readonly ConversationEntry[] {
		return [...this.stored, ...this.live];
	}

	opened(stored: readonly ConversationEntry[]): void {
		this.stored = stored;
		this.live = [];
		this.pending = undefined;
	}

	admitted(admitted: Admitted): void {
		this.pending = admitted;
	}

	ended(code: string, output: string, halted: boolean): void {
		const problems = this.pending?.problems ?? [];
		this.pending = undefined;
		this.live.push({ role: "assistant", content: code });
		if (halted) return;
		this.live.push({
			role: "tool",
			content: output,
			...(problems.length > 0 ? { problems } : {}),
		});
	}
}

export function conversationExtension(host: ConversationHost): InterpExtension {
	const conversation = new Conversation();
	const extension = (interp: Interp): void => define(interp, []);
	return Object.assign(extension, {
		prompt: host.prompt(),
		session(hooks: SessionHooks): void {
			hooks.fill(conversationSlot, conversation);
			hooks.turnStart.use(function* (ctx, next) {
				conversation.opened(yield* settled(host.store.stored()));
				yield* next(ctx);
			});
			hooks.beginStep.use(function* (ctx, next) {
				define(ctx.interp, conversation.entries());
				yield* next(ctx);
			});
			hooks.admit.use(async (interp, code, next) => {
				const admission = await next(interp, code);
				conversation.admitted({
					code: admission.code,
					...(admission.problems ? { problems: admission.problems } : {}),
				});
				return admission;
			});
			hooks.stepEnd.use((turn, step, verdict, next) => {
				const decided = next(turn, step, verdict);
				conversation.ended(step.code, step.output, decided === "halt");
				return decided;
			});
		},
	});
}
