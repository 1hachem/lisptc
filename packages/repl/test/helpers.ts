import {
	type Compactor,
	compactionExtension,
} from "@repo/compaction-extension";
import type { InterpExtension } from "@repo/interpreter/lisp";
import { memoryExtension } from "@repo/memory-extension";
import { llmSlot, type Observed } from "@repo/interpreter/observe";
import { promisesExtension } from "@repo/promises-extension";
import { proseExtension } from "@repo/prose-extension";
import { secretsExtension } from "@repo/secrets-extension";
import type { SessionHooks } from "@repo/interpreter/session";
import { uiExtension } from "@repo/ui-extension";
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
