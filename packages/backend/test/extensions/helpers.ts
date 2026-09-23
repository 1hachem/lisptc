import { randomUUID } from "node:crypto";
import {
	type Compactor,
	compactionExtension,
} from "@repo/compaction-extension";
import { compactionHost } from "@repo/compaction-extension/host";
import { llmSlot, type Observed } from "@repo/interpreter/observe";
import type { InterpExtension, SessionHooks } from "@repo/interpreter/session";
import type {
	ConnectResult,
	McpClient,
	ToolCall,
} from "@repo/mcp-extension/ports";
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

export interface MockServer {
	tools: string[];
	connectDelayMs?: number;
}

const TOOL_SCHEMA = {
	type: "object",
	properties: { message: { type: "string" } },
} as const;

function delay(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(resolve, ms);
		signal?.addEventListener(
			"abort",
			() => {
				clearTimeout(timer);
				reject(new Error("aborted"));
			},
			{ once: true },
		);
	});
}

export function mockMcpClient(
	servers: Record<string, MockServer>,
): McpClient & { calls: ToolCall[] } {
	const calls: ToolCall[] = [];
	const live = new Map<string, string>();

	async function connect(
		conf: { name: string },
		signal?: AbortSignal,
	): Promise<ConnectResult> {
		const spec = servers[conf.name];
		if (!spec) throw new Error(`cannot start MCP server "${conf.name}"`);
		if (spec.connectDelayMs) await delay(spec.connectDelayMs, signal);
		if (spec.tools.length === 0)
			throw new Error("connected but the server exposed no tools");
		const serverId = randomUUID();
		live.set(serverId, conf.name);
		return {
			serverId,
			tools: spec.tools.map((name) => ({
				name,
				description: "Echo back the given message.",
				inputSchema: TOOL_SCHEMA,
			})),
		};
	}

	return {
		calls,
		connect,
		callTool: async (call) => {
			if (!live.has(call.serverId))
				throw new Error(`no such server: ${call.serverId}`);
			calls.push(call);
			return call.args.message ?? null;
		},
		disconnect: async (serverId) => {
			live.delete(serverId);
		},
		login: async () => ({ authUrl: null }),
		logout: async () => {},
		authorize: async () => {},
		shutdown: async () => {
			live.clear();
		},
	};
}
