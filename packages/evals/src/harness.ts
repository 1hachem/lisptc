import { Compactor, compactionExtension } from "@repo/interpreter/compaction";
import { mcpExtension } from "@repo/interpreter/mcp";
import {
	EnvSecretsStore,
	type SecretsStore,
	secretsExtension,
} from "@repo/interpreter/secrets";
import { modelFacingExtensions } from "@repo/repl/extensions";
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
	secrets: SecretsStore;
}

export function tracedRepl(options: HarnessOptions = {}): Harness {
	const secrets = new EnvSecretsStore();
	const trace = new Trace({ secrets });
	const repl = new AgentRepl({
		extensions: modelFacingExtensions({
			secrets: secretsExtension({ store: secrets }),
			mcp: mcpExtension({
				dispatch: trace.dispatch(
					mockDispatch(options.mocks ?? { servers: {} }),
				),
			}),
			...(options.wordLimit
				? { compaction: compactionExtension(new Compactor(options.wordLimit)) }
				: {}),
			extra: [trace.extension()],
		}),
	});
	return { repl, trace, secrets };
}
