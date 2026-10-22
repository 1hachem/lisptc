import { fileURLToPath } from "node:url";
import { bufferTransport } from "@repo/interpreter/channels-host";
import { type Interp, runSync } from "@repo/interpreter/lisp";
import { note } from "@repo/interpreter/topics";
import type { McpExtensionHost } from "../src/mcp.ts";
import type {
	ConnConfig,
	McpClient,
	McpHost,
	ServerHandle,
	ServerState,
	StdioConnConfig,
} from "../src/ports.ts";

export const FIXTURE = fileURLToPath(
	new URL("./fixture-mcp-server.ts", import.meta.url),
);

export function fixtureServer(
	name: string,
	options: { script?: string; delayMs?: number } = {},
): StdioConnConfig {
	const { script = FIXTURE, delayMs } = options;
	return {
		name,
		command: "node",
		args: ["--no-warnings", "--experimental-transform-types", script],
		...(delayMs === undefined
			? {}
			: { env: { LISPTC_FIXTURE_DELAY_MS: String(delayMs) } }),
	};
}

export function withServers(
	host: McpExtensionHost,
	...servers: ConnConfig[]
): McpExtensionHost {
	const { toolkit } = host;
	return { ...host, toolkit: { all: () => [...toolkit.all(), ...servers] } };
}

export function recordingHost(): McpHost & {
	ensured: ConnConfig[];
	stopped: string[];
	stoppedAll: number;
	uses: string[];
	sleeping: Set<string>;
} {
	const ensured: ConnConfig[] = [];
	const stopped: string[] = [];
	const uses: string[] = [];
	const sleeping = new Set<string>();
	let stoppedAll = 0;
	return {
		ensured,
		stopped,
		uses,
		sleeping,
		get stoppedAll() {
			return stoppedAll;
		},
		ensure: async (conf): Promise<ServerHandle | undefined> => {
			ensured.push(conf);
			return "url" in conf ? { url: conf.url } : undefined;
		},
		stop: async (name) => {
			stopped.push(name);
		},
		stopAll: async () => {
			stoppedAll += 1;
		},
		status: (name): ServerState => (name === "known" ? "running" : "unknown"),
		logs: (name) => (name === "known" ? "the fallback's log" : ""),
		used(name) {
			uses.push(name);
		},
		asleep: async (name) => sleeping.has(name),
	};
}

export function reportOf(interp: Interp, code: string): string {
	const buffer = bufferTransport();
	const detach = interp.channels.pipe(buffer);
	try {
		runSync(interp, code);
	} catch {
	} finally {
		detach();
	}
	return buffer
		.collect(note)
		.filter((n) => n.kind === "failed")
		.map((n) => n.text)
		.join("");
}

export function countingHost(
	host: McpExtensionHost,
	connects: ConnConfig[],
	refuse?: Error,
): McpExtensionHost {
	const { client } = host;
	const counting: McpClient = {
		connect: (conf, signal) => {
			connects.push(conf);
			return refuse === undefined
				? client.connect(conf, signal)
				: Promise.reject(refuse);
		},
		callTool: (call, signal) => client.callTool(call, signal),
		disconnect: (serverId) => client.disconnect(serverId),
		login: (conf) => client.login(conf),
		logout: (conf) => client.logout(conf),
		authorize: (conf, code) => client.authorize(conf, code),
		asleep: (serverId) => client.asleep(serverId),
		shutdown: () => client.shutdown(),
	};
	return { ...host, client: counting };
}
