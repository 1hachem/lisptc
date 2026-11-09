import type {
	ConnConfig,
	HttpConnConfig,
	McpHost,
	ServerHandle,
	ServerReporter,
	ServerState,
} from "./ports.ts";
import { reachable } from "./start-wait.ts";

export function remoteServer(conf: ConnConfig): conf is HttpConnConfig {
	return "url" in conf && conf.command === undefined;
}

export class RemoteHost implements McpHost {
	private readonly dialed = new Set<string>();

	constructor(private readonly report: ServerReporter = () => {}) {}

	async ensure(conf: ConnConfig): Promise<ServerHandle> {
		if (!remoteServer(conf))
			throw new Error(`${conf.name}: is not a remote server.`);
		this.dialed.add(conf.name);
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

	async stop(name: string): Promise<void> {
		if (this.dialed.delete(name)) this.report({ server: name, phase: "gone" });
	}

	async remove(conf: ConnConfig): Promise<void> {
		this.dialed.delete(conf.name);
		this.report({ server: conf.name, phase: "gone" });
	}

	async stopAll(): Promise<void> {
		for (const name of [...this.dialed]) await this.stop(name);
	}

	status(name: string): ServerState {
		return this.dialed.has(name) ? "running" : "unknown";
	}

	logs(_name: string): string {
		return "";
	}

	used(_name: string): void {}

	async asleep(_name: string): Promise<boolean> {
		return false;
	}
}
