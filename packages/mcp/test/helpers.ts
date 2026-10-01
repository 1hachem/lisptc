import { bufferTransport } from "@repo/interpreter/channels-host";
import { type Interp, runSync } from "@repo/interpreter/lisp";
import { note } from "@repo/interpreter/topics";
import type {
	ConnConfig,
	McpHost,
	ServerHandle,
	ServerState,
} from "../src/ports.ts";

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
