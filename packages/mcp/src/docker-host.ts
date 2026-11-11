import { DockerRunner, type RunningContainer } from "@repo/containers/docker";
import { type RunSpec, runSpecFor } from "@repo/containers/launch";
import {
	type AddressHandle,
	type ConnConfig,
	type McpHost,
	refKey,
	refOf,
	type ServerHandle,
	type ServerRef,
	type ServerReporter,
	type ServerState,
	type StartWatch,
	subjectOf,
} from "./ports.ts";

interface Served {
	server: ServerRef;
	container: RunningContainer;
	handle: AddressHandle;
}

export class DockerHost implements McpHost {
	private readonly served = new Map<string, Served>();
	private readonly runner = new DockerRunner();

	constructor(private readonly report: ServerReporter = () => {}) {}

	async ensure(conf: ConnConfig, watch?: StartWatch): Promise<ServerHandle> {
		const spec = runSpecFor(conf);
		if (spec === undefined)
			throw new Error(`${conf.name}: has no container to run.`);
		const running = this.served.get(refKey(conf));
		if (running) return running.handle;
		return await this.start(conf, spec, watch);
	}

	async stop(server: ServerRef): Promise<void> {
		if (await this.drop(server))
			this.report({ ...subjectOf(server), phase: "sleeping" });
	}

	async remove(conf: ConnConfig): Promise<void> {
		await this.drop(conf);
		this.report({ ...subjectOf(conf), phase: "gone" });
	}

	private async drop(server: ServerRef): Promise<boolean> {
		const served = this.served.get(refKey(server));
		if (!served) return false;
		this.served.delete(refKey(server));
		await served.container.stop();
		return true;
	}

	async stopAll(): Promise<void> {
		for (const { server } of [...this.served.values()]) await this.stop(server);
		await this.runner.reap();
	}

	status(server: ServerRef): ServerState {
		return this.served.has(refKey(server)) ? "running" : "unknown";
	}

	logs(server: ServerRef): string {
		return this.served.get(refKey(server))?.container.logs() ?? "";
	}

	used(_server: ServerRef): void {}

	async asleep(_server: ServerRef): Promise<boolean> {
		return false;
	}

	private async start(
		conf: ConnConfig,
		spec: RunSpec,
		watch?: StartWatch,
	): Promise<ServerHandle> {
		const key = refKey(conf);
		this.report({ ...subjectOf(conf), phase: "starting" });
		try {
			watch?.progress?.(`${conf.name} is starting its container`);
			let served: Served | undefined;
			const container = await this.runner.run(
				spec,
				(reason) => {
					if (served === undefined || this.served.get(key) !== served) return;
					this.served.delete(key);
					this.report({ ...subjectOf(conf), phase: "failed", reason });
				},
				watch,
			);
			const headers = "headers" in conf ? conf.headers : undefined;
			served = {
				server: refOf(conf),
				container,
				handle: headers
					? { url: container.url, headers }
					: { url: container.url },
			};
			this.served.set(key, served);
			this.report({ ...subjectOf(conf), phase: "ready" });
			return served.handle;
		} catch (ex) {
			this.report({
				...subjectOf(conf),
				phase: "failed",
				reason: ex instanceof Error ? ex.message : String(ex),
			});
			throw ex;
		}
	}
}
