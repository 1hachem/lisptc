import { randomUUID } from "node:crypto";
import type { Trace } from "@repo/checks/trace";
import type { InterpExtension } from "@repo/interpreter/session";
import { mcpExtension } from "@repo/mcp-extension";
import { mcpHost } from "@repo/mcp-extension/mcp-host";
import type {
	ConnectResult,
	McpClient,
	ToolCall,
} from "@repo/mcp-extension/ports";
import {
	type SecretsExtension,
	secretsExtension,
} from "@repo/secrets-extension";
import { secretsHost } from "@repo/secrets-extension/host";
import type { SecretsStore } from "@repo/secrets-extension/ports";

export interface EvalRun {
	trace: Trace;
	mocks: MockSpec;
	secrets: SecretsStore;
}

let current: EvalRun | undefined;

export function withRun<T>(run: EvalRun, build: () => T): T {
	current = run;
	try {
		return build();
	} finally {
		current = undefined;
	}
}

function run(what: string): EvalRun {
	if (!current)
		throw new Error(
			`${what} is only available inside an eval case's extensions list`,
		);
	return current;
}

export function mockedMcpExtension(): InterpExtension {
	const { trace, mocks } = run("mockedMcpExtension()");
	return mcpExtension({ ...mcpHost, client: trace.client(mockClient(mocks)) });
}

export function tracedSecretsExtension(): SecretsExtension {
	return secretsExtension({
		...secretsHost,
		store: run("tracedSecretsExtension()").secrets,
	});
}

export interface MockTool {
	name: string;
	description?: string;
	inputSchema?: Record<string, unknown>;
}

type MockCall = (args: Record<string, unknown>) => unknown;

type MockResult =
	| MockCall
	| Record<string, unknown>
	| unknown[]
	| string
	| number
	| boolean
	| null;

export interface MockServer {
	tools: MockTool[];
	connectDelayMs?: number;
	fails?: string;
	calls?: Record<string, MockResult>;
	otherwise?: MockResult;
}

export interface MockSpec {
	servers: Record<string, MockServer>;
}

interface Live {
	name: string;
	server: MockServer;
}

const EMPTY_SCHEMA = { type: "object", properties: {} } as const;

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

function mockClient(spec: MockSpec): McpClient {
	const live = new Map<string, Live>();

	async function connect(
		conf: { name: string },
		signal?: AbortSignal,
	): Promise<ConnectResult> {
		const name = conf.name;
		const server = spec.servers[name];
		if (!server) {
			console.warn(
				`[evals] no mock for MCP server "${name}" — add it to the case's mocks`,
			);
			throw new Error(`cannot start MCP server "${name}"`);
		}
		if (server.connectDelayMs) await delay(server.connectDelayMs, signal);
		if (server.fails) throw new Error(server.fails);
		if (server.tools.length === 0)
			throw new Error("connected but the server exposed no tools");
		const serverId = randomUUID();
		live.set(serverId, { name, server });
		return {
			serverId,
			tools: server.tools.map((tool) => ({
				name: tool.name,
				description: tool.description ?? "",
				inputSchema: tool.inputSchema ?? EMPTY_SCHEMA,
			})),
		};
	}

	function callTool({ serverId, tool, args }: ToolCall): unknown {
		const entry = live.get(serverId);
		if (!entry) throw new Error(`no such server: ${serverId}`);
		const specific = entry.server.calls?.[tool];
		const result = specific ?? entry.server.otherwise;
		if (specific === undefined)
			console.warn(
				`[evals] no mock result for ${entry.name}/${tool} — add it to the case's mocks`,
			);
		if (result === undefined)
			throw new Error(`${entry.name}/${tool} is unavailable`);
		const value = typeof result === "function" ? result(args ?? {}) : result;
		if (value !== null && typeof value === "object" && "error" in value)
			throw new Error(String((value as { error: unknown }).error));
		return value;
	}

	return {
		connect,
		callTool: async (call) => callTool(call),
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
