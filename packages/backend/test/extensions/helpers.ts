import {
	type Compactor,
	compactionExtension,
} from "@repo/compaction-extension";
import { compactionHost } from "@repo/compaction-extension/host";
import type { InterpExtension } from "@repo/interpreter/lisp";
import { llmSlot, type Observed } from "@repo/interpreter/observe";
import type { SessionHooks } from "@repo/interpreter/session";
import { memoryExtension } from "@repo/memory-extension";
import { memoryHostFor } from "@repo/memory-extension/host";
import { promisesExtension } from "@repo/promises-extension";
import { promisesHost } from "@repo/promises-extension/host";
import { proseExtension } from "@repo/prose-extension";
import { proseHost } from "@repo/prose-extension/host";
import { AgentRepl, MemoryRepl } from "@repo/repl/repl";
import { secretsExtension } from "@repo/secrets-extension";
import { secretsHost } from "@repo/secrets-extension/host";
import { uiExtension } from "@repo/ui-extension";
import { uiHost } from "@repo/ui-extension/host";

export function modelFacing(
	compactor?: Compactor,
	scope?: string,
): InterpExtension[] {
	return [
		secretsExtension(secretsHost),
		promisesExtension(promisesHost),
		compactionExtension(compactionHost, { compactor }),
		memoryExtension(memoryHostFor(scope)),
		proseExtension(proseHost),
		uiExtension(uiHost),
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
