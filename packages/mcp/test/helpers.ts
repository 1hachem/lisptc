import { bufferTransport } from "@repo/interpreter/channels-host";
import { type Interp, runSync } from "@repo/interpreter/lisp";
import { note } from "@repo/interpreter/topics";
import type { McpExtensionHost } from "../src/mcp.ts";
import type {
	ConnConfig,
	HeldState,
	McpClient,
	McpHost,
	ServerHandle,
	ServerState,
} from "../src/ports.ts";

export function recordingHost(): McpHost & {
	ensured: ConnConfig[];
	stopped: string[];
	stoppedAll: number;
	uses: string[];
	phases: Map<string, HeldState>;
} {
	const ensured: ConnConfig[] = [];
	const stopped: string[] = [];
	const uses: string[] = [];
	const phases = new Map<string, HeldState>();
	let stoppedAll = 0;
	return {
		ensured,
		stopped,
		uses,
		phases,
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
		phase: async (name) => phases.get(name) ?? { phase: "ready" },
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
		phase: (serverId) => client.phase(serverId),
		login: (conf) => client.login(conf),
		logout: (conf) => client.logout(conf),
		authorize: (conf, code) => client.authorize(conf, code),
		shutdown: () => client.shutdown(),
	};
	return { ...host, client: counting };
}
