import { compactionExtension } from "@repo/compaction-extension";
import { compactionHost } from "@repo/compaction-extension/host";
import type { InterpExtension } from "@repo/interpreter/lisp";
import { memoryExtension } from "@repo/memory-extension";
import { memoryHostFor } from "@repo/memory-extension/host";
import { promisesExtension } from "@repo/promises-extension";
import { promisesHost } from "@repo/promises-extension/host";
import { proseExtension } from "@repo/prose-extension";
import { proseHost } from "@repo/prose-extension/host";
import { AgentRepl } from "@repo/repl/repl";
import { secretsExtension } from "@repo/secrets-extension";
import { secretsHost } from "@repo/secrets-extension/host";
import { uiExtension } from "@repo/ui-extension";
import { uiHost } from "@repo/ui-extension/host";
import { ReplStore } from "../src/repl-store.ts";

export function testExtensions(scope?: string): InterpExtension[] {
	return [
		secretsExtension(secretsHost),
		promisesExtension(promisesHost),
		compactionExtension(compactionHost),
		memoryExtension(memoryHostFor(scope)),
		proseExtension(proseHost),
		uiExtension(uiHost),
	];
}

export function testRepl(scope?: string): AgentRepl {
	return new AgentRepl({ extensions: testExtensions(scope) });
}

export function testRepls(scope?: string): ReplStore {
	return new ReplStore(() => testRepl(scope));
}
