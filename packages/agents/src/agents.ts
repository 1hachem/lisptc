import { effect } from "@repo/interpreter/effects";
import type { Interp } from "@repo/interpreter/lisp";
import { Cell, type List } from "@repo/interpreter/objects";
import { zList } from "@repo/interpreter/schema";
import type { InterpExtension } from "@repo/interpreter/session";
import type { PromptSource } from "@repo/shared/host";
import { z } from "zod";

export interface AgentsHost {
	prompt: PromptSource;
}

export function agentsExtension(host: AgentsHost): InterpExtension {
	return Object.assign((interp: Interp): void => registerAgents(interp), {
		prompt: host.prompt(),
	});
}

function lastOf(values: List): unknown {
	let last: unknown = null;
	for (let at: unknown = values; at instanceof Cell; at = at.cdr) last = at.car;
	return last;
}

export function registerAgents(interp: Interp): void {
	interp.def(
		"quietly",
		-1,
		"(quietly form...)",
		"Run the forms of a message without handing the message to the agent. The message and what the forms printed stay in the chat, so the agent reads them on its next turn. Return the value of the last form.",
		z.tuple([zList]),
		([forms]) => {
			effect.emit(interp.channels, { harness: { type: "quiet" } });
			return lastOf(forms);
		},
	);
}
