import {
	type Compactor,
	compactionExtension,
} from "@repo/interpreter/compaction";
import type { InterpExtension } from "@repo/interpreter/lisp";
import { memoryExtension } from "@repo/interpreter/memory";
import { llmSlot, type Observed } from "@repo/interpreter/observe";
import { promisesExtension } from "@repo/interpreter/promises";
import { proseExtension } from "@repo/interpreter/prose";
import { secretsExtension } from "@repo/interpreter/secrets";
import type { SessionHooks } from "@repo/interpreter/session";
import { uiExtension } from "@repo/interpreter/ui";
import { AgentRepl, MemoryRepl } from "../src/repl.ts";

export function modelFacing(compactor?: Compactor): InterpExtension[] {
	return [
		secretsExtension(),
		promisesExtension(),
		compactionExtension(undefined, { compactor }),
		memoryExtension(),
		proseExtension(),
		uiExtension(),
	];
}

export function observedExtension(): InterpExtension {
	const observed: Observed = {};
	return Object.assign(() => {}, {
		session(hooks: SessionHooks): void {
			hooks.fill(llmSlot, observed);
		},
	});
}

export function memoryRepl(
	extensions: InterpExtension[] = modelFacing(),
): MemoryRepl {
	return new MemoryRepl({ extensions });
}

export function agentRepl(
	extensions: InterpExtension[] = modelFacing(),
): AgentRepl {
	return new AgentRepl({ extensions });
}
