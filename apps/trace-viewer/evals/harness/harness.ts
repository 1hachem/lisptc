import { Trace } from "@repo/checks/trace";
import {
	type ConversationStore,
	conversationExtension,
} from "@repo/conversation-extension";
import { conversationHostFor } from "@repo/conversation-extension/host";
import type { InterpExtension } from "@repo/interpreter/session";
import { AgentRepl } from "@repo/repl/repl";
import { envSecretsStore } from "@repo/secrets-extension/host";
import type { SecretsStore } from "@repo/secrets-extension/ports";
import { type MockSpec, withRun } from "./mocks.ts";

export type ExtensionsFor = () => InterpExtension[];

export interface HarnessOptions {
	mocks?: MockSpec;
	extensions: ExtensionsFor;
	conversation?: ConversationStore;
}

export interface Harness {
	repl: AgentRepl;
	trace: Trace;
	secrets: SecretsStore;
}

export function tracedRepl(options: HarnessOptions): Harness {
	const secrets = envSecretsStore();
	const trace = new Trace({ secrets });
	const mocks = options.mocks ?? { servers: {} };
	const extensions = withRun({ trace, mocks, secrets }, () => [
		conversationExtension(conversationHostFor(options.conversation)),
		...options.extensions(),
		trace.extension(),
	]);
	return { repl: new AgentRepl({ extensions }), trace, secrets };
}
