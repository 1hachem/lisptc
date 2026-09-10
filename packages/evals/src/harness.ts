import { EnvSecretsStore } from "@repo/interpreter/secrets";
import { AgentRepl } from "@repo/repl/repl";
import { type MockSpec, mockDispatch } from "./mocks.ts";
import { Trace } from "./trace.ts";

export interface HarnessOptions {
	mocks?: MockSpec;
	wordLimit?: number;
}

export interface Harness {
	repl: AgentRepl;
	trace: Trace;
}

export function tracedRepl(options: HarnessOptions = {}): Harness {
	const secrets = new EnvSecretsStore();
	const trace = new Trace({ secrets });
	const repl = new AgentRepl({
		secretsStore: secrets,
		extensions: [trace.extension()],
		mcpDispatch: trace.dispatch(mockDispatch(options.mocks ?? { servers: {} })),
		...(options.wordLimit ? { wordLimit: options.wordLimit } : {}),
	});
	return { repl, trace };
}
