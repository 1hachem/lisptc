import { compactionExtension } from "@repo/interpreter/compaction";
import { compactionHost } from "@repo/interpreter/compaction-host";
import type { InterpExtension } from "@repo/interpreter/lisp";
import { memoryExtension } from "@repo/interpreter/memory";
import { memoryHostFor } from "@repo/interpreter/memory-host";
import { promisesExtension } from "@repo/interpreter/promises";
import { promisesHost } from "@repo/interpreter/promises-host";
import { proseExtension } from "@repo/interpreter/prose";
import { proseHost } from "@repo/interpreter/prose-host";
import { secretsExtension } from "@repo/interpreter/secrets";
import { secretsHost } from "@repo/interpreter/secrets-host";
import { uiExtension } from "@repo/interpreter/ui";
import { uiHost } from "@repo/interpreter/ui-host";
import { AgentRepl } from "@repo/repl/repl";
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
