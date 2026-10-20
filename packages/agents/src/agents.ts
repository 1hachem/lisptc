import { effect } from "@repo/interpreter/effects";
import { type Interp, runSync } from "@repo/interpreter/lisp";
import { newSym } from "@repo/interpreter/objects";
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

export function registerAgents(interp: Interp): void {
	interp.def(
		"agents/quiet",
		0,
		"(agents/quiet)",
		"Ask the harness not to hand this message to the agent. quietly calls it before its forms run; call quietly instead.",
		z.tuple([]),
		() => {
			effect.emit(interp.channels, { harness: { type: "quiet" } });
			return null;
		},
	);
	interp.defineGlobal(
		newSym("quietly"),
		runSync(
			interp,
			"(macro (&rest forms) (cons 'progn (cons '(agents/quiet) forms)))",
		),
		{
			signature: "(quietly form...)",
			doc: "Run the forms of a message without handing the message to the agent, even when a form inside fails or waits. The message and what the forms printed stay in the chat, so the agent reads them on its next turn. Return the value of the last form.",
		},
	);
}
