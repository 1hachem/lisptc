import { type MockSpec, withRun } from "./mocks.ts";
import { Trace } from "@repo/checks/trace";
import type { InterpExtension } from "@repo/interpreter/lisp";
import { AgentRepl } from "@repo/repl/repl";
import type { SecretsStore } from "@repo/secrets-extension";
import { envSecretsStore } from "@repo/secrets-extension/host";

export type ExtensionsFor = () => InterpExtension[];

export interface HarnessOptions {
	mocks?: MockSpec;
	extensions: ExtensionsFor;
}

export interface Harness {
	repl: AgentRepl;
	trace: Trace;
	secrets: SecretsStore;
}

export function tracedRepl(options: HarnessOptions): Harness {
	const secrets = envSecretsStore();
	const trace = new Trace({
		secretValues: () =>
			secrets
				.list()
				.map(([key]) => secrets.get(key)?.value)
				.filter((value): value is string => Boolean(value)),
	});
	const mocks = options.mocks ?? { servers: {} };
	const extensions = withRun({ trace, mocks, secrets }, () => [
		...options.extensions(),
		trace.extension(),
	]);
	return { repl: new AgentRepl({ extensions }), trace, secrets };
}
