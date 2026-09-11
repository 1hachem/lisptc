import { randomUUID } from "node:crypto";
import type { Dispatch } from "@repo/interpreter/promises";

export interface MockTool {
	name: string;
	description?: string;
	inputSchema?: Record<string, unknown>;
}

export type MockCall = (args: Record<string, unknown>) => unknown;

export type MockResult =
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

export function mockDispatch(spec: MockSpec): Dispatch {
	const live = new Map<string, Live>();

	async function connect(
		payload: unknown,
		signal?: AbortSignal,
	): Promise<unknown> {
		const name = (payload as { name?: string }).name ?? "";
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

	function callTool(payload: unknown): unknown {
		const { serverId, tool, args } = payload as {
			serverId: string;
			tool: string;
			args: Record<string, unknown>;
		};
		const entry = live.get(serverId);
		if (!entry) throw new Error(`no such server: ${serverId}`);
		const result = entry.server.calls?.[tool];
		if (result === undefined) {
			console.warn(
				`[evals] no mock result for ${entry.name}/${tool} — add it to the case's mocks`,
			);
			throw new Error(`${entry.name}/${tool} is unavailable`);
		}
		const value = typeof result === "function" ? result(args ?? {}) : result;
		if (value !== null && typeof value === "object" && "error" in value)
			throw new Error(String((value as { error: unknown }).error));
		return value;
	}

	return async (op, payload, signal) => {
		switch (op) {
			case "connect":
				return connect(payload, signal);
			case "call-tool":
				return callTool(payload);
			case "list-tools": {
				const entry = live.get((payload as { serverId: string }).serverId);
				if (!entry) throw new Error("no such server");
				return entry.server.tools;
			}
			case "disconnect":
				live.delete((payload as { serverId: string }).serverId);
				return { ok: true };
			case "login":
				return { authUrl: null };
			case "authorize":
			case "logout":
				return { ok: true };
			default:
				throw new Error(`unknown op: ${op}`);
		}
	};
}
