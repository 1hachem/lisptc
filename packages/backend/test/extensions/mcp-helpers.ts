import type {
	ConnConfig,
	McpHost,
	ServerHandle,
	ServerState,
} from "@repo/mcp-extension/ports";

export function recordingHost(): McpHost & {
	ensured: ConnConfig[];
	stopped: string[];
	stoppedAll: number;
} {
	const ensured: ConnConfig[] = [];
	const stopped: string[] = [];
	let stoppedAll = 0;
	return {
		ensured,
		stopped,
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
	};
}
