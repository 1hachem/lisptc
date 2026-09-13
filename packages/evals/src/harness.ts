import {
	type CompactionExtension,
	Compactor,
	compactionExtension,
} from "@repo/interpreter/compaction";
import type { InterpExtension } from "@repo/interpreter/lisp";
import { promisesExtension } from "@repo/interpreter/promises";
import { proseExtension } from "@repo/interpreter/prose";
import {
	EnvSecretsStore,
	type SecretsExtension,
	type SecretsStore,
	secretsExtension,
} from "@repo/interpreter/secrets";
import { llmExtension } from "@repo/llm/llm";
import { mcpExtension } from "@repo/mcp";
import { AgentRepl } from "@repo/repl/repl";
import { type MockSpec, mockClient } from "./mocks.ts";
import { Trace } from "./trace.ts";

export interface EvalKit {
	secrets: SecretsExtension;
	mcp: InterpExtension;
	compaction: CompactionExtension;
}

export type ExtensionsFor = (kit: EvalKit) => InterpExtension[];

export interface HarnessOptions {
	mocks?: MockSpec;
	wordLimit?: number;
	extensions?: ExtensionsFor;
}

export interface Harness {
	repl: AgentRepl;
	trace: Trace;
	secrets: SecretsStore;
}

const modelFacing: ExtensionsFor = ({ secrets, mcp, compaction }) => [
	secrets,
	promisesExtension(),
	mcp,
	llmExtension(),
	compaction,
	proseExtension(),
];

export function tracedRepl(options: HarnessOptions = {}): Harness {
	const secrets = new EnvSecretsStore();
	const trace = new Trace({ secrets });
	const kit: EvalKit = {
		secrets: secretsExtension({ store: secrets }),
		mcp: mcpExtension({
			client: trace.client(mockClient(options.mocks ?? { servers: {} })),
		}),
		compaction: compactionExtension(
			options.wordLimit ? new Compactor(options.wordLimit) : undefined,
		),
	};
	const repl = new AgentRepl({
		extensions: [
			...(options.extensions ?? modelFacing)(kit),
			trace.extension(),
		],
	});
	return { repl, trace, secrets };
}
