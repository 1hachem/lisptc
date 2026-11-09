import {
	type ConnConfig,
	type HttpConnConfig,
	type McpHost,
	refKey,
	refOf,
	type ServerHandle,
	type ServerRef,
	type ServerReporter,
	type ServerState,
	subjectOf,
} from "./ports.ts";
import { reachable } from "./start-wait.ts";

export function remoteServer(conf: ConnConfig): conf is HttpConnConfig {
	return "url" in conf && conf.command === undefined;
}

export class RemoteHost implements McpHost {
	private readonly dialed = new Map<string, ServerRef>();

	constructor(private readonly report: ServerReporter = () => {}) {}

	async ensure(conf: ConnConfig): Promise<ServerHandle> {
		if (!remoteServer(conf))
			throw new Error(`${conf.name}: is not a remote server.`);
		this.dialed.set(refKey(conf), refOf(conf));
		const origin = new URL(conf.url).origin;
		this.report(
			(await reachable(origin))
				? { ...subjectOf(conf), phase: "ready" }
				: {
						...subjectOf(conf),
						phase: "failed",
						reason: `${origin} did not answer.`,
					},
		);
		return conf.headers
			? { url: conf.url, headers: conf.headers }
			: { url: conf.url };
	}

	async stop(server: ServerRef): Promise<void> {
		if (this.dialed.delete(refKey(server)))
			this.report({ ...subjectOf(server), phase: "gone" });
	}

	async remove(conf: ConnConfig): Promise<void> {
		this.dialed.delete(refKey(conf));
		this.report({ ...subjectOf(conf), phase: "gone" });
	}

	async stopAll(): Promise<void> {
		for (const server of [...this.dialed.values()]) await this.stop(server);
	}

	status(server: ServerRef): ServerState {
		return this.dialed.has(refKey(server)) ? "running" : "unknown";
	}

	logs(_server: ServerRef): string {
		return "";
	}

	used(_server: ServerRef): void {}

	async asleep(_server: ServerRef): Promise<boolean> {
		return false;
	}
}
