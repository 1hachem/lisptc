import {
	type MockSpec,
	mockedMcpExtension,
	tracedSecretsExtension,
	withRun,
} from "@repo/checks/mocks";
import { Trace } from "@repo/checks/trace";
import { compactionExtension } from "@repo/interpreter/compaction";
import type { InterpExtension } from "@repo/interpreter/lisp";
import { memoryExtension } from "@repo/interpreter/memory";
import { promisesExtension } from "@repo/interpreter/promises";
import { proseExtension } from "@repo/interpreter/prose";
import { EnvSecretsStore, type SecretsStore } from "@repo/interpreter/secrets";
import { llmExtension } from "@repo/llm/llm";
import { AgentRepl } from "@repo/repl/repl";

export type ExtensionsFor = () => InterpExtension[];

export interface HarnessOptions {
	mocks?: MockSpec;
	extensions?: ExtensionsFor;
}

export interface Harness {
	repl: AgentRepl;
	trace: Trace;
	secrets: SecretsStore;
}

const modelFacing: ExtensionsFor = () => [
	tracedSecretsExtension(),
	promisesExtension(),
	mockedMcpExtension(),
	llmExtension(),
	compactionExtension(),
	memoryExtension(),
	proseExtension(),
];

export function tracedRepl(options: HarnessOptions = {}): Harness {
	const secrets = new EnvSecretsStore();
	const trace = new Trace({ secrets });
	const mocks = options.mocks ?? { servers: {} };
	const extensions = withRun({ trace, mocks, secrets }, () => [
		...(options.extensions ?? modelFacing)(),
		trace.extension(),
	]);
	return { repl: new AgentRepl({ extensions }), trace, secrets };
}
