import { reachable } from "@repo/containers/start-wait";
import type { RemoteEntry } from "@repo/toolkit";
import type {
	ConnConfig,
	McpHost,
	ServerHandle,
	ServerRef,
	ServerReporter,
	ServerState,
} from "./ports.ts";

export function remoteServer(conf: ConnConfig): conf is RemoteEntry {
	return "url" in conf && !("command" in conf);
}

export class RemoteHost implements McpHost {
	private readonly dialed = new Map<string, ServerRef>();

	constructor(private readonly report: ServerReporter = () => {}) {}

	async ensure(conf: ConnConfig): Promise<ServerHandle> {
		if (!remoteServer(conf))
			throw new Error(`${conf.name}: is not a remote server.`);
		this.dialed.set(conf.name, { name: conf.name });
		const origin = new URL(conf.url).origin;
		this.report(
			(await reachable(origin))
				? { server: conf.name, phase: "ready" }
				: {
						server: conf.name,
						phase: "failed",
						reason: `${origin} did not answer.`,
					},
		);
		return conf.headers
			? { url: conf.url, headers: conf.headers }
			: { url: conf.url };
	}

	async stop(server: ServerRef): Promise<void> {
		if (this.dialed.delete(server.name))
			this.report({ server: server.name, phase: "gone" });
	}

	async remove(conf: ConnConfig): Promise<void> {
		this.dialed.delete(conf.name);
		this.report({ server: conf.name, phase: "gone" });
	}

	async stopAll(): Promise<void> {
		for (const server of [...this.dialed.values()]) await this.stop(server);
	}

	status(server: ServerRef): ServerState {
		return this.dialed.has(server.name) ? "running" : "unknown";
	}

	logs(_server: ServerRef): string {
		return "";
	}

	used(_server: ServerRef): void {}

	async asleep(_server: ServerRef): Promise<boolean> {
		return false;
	}
}
