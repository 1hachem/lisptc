import type {
	ConnConfig,
	McpHost,
	ServerHandle,
	ServerRef,
	ServerState,
	StartWatch,
} from "./ports.ts";

export interface HostRoute {
	claims(conf: ConnConfig): boolean;
	host: McpHost;
}

export class RoutedHost implements McpHost {
	private readonly owners = new Map<string, McpHost>();

	constructor(private readonly routes: readonly HostRoute[]) {}

	async ensure(conf: ConnConfig, watch?: StartWatch): Promise<ServerHandle> {
		const host = this.hostOf(conf);
		this.owners.set(conf.name, host);
		return await host.ensure(conf, watch);
	}

	async stop(server: ServerRef): Promise<void> {
		await this.ownerOf(server)?.stop(server);
	}

	async stopAll(): Promise<void> {
		await Promise.all(
			[...new Set(this.routes.map((route) => route.host))].map((host) =>
				host.stopAll(),
			),
		);
	}

	status(server: ServerRef): ServerState {
		return this.ownerOf(server)?.status(server) ?? "unknown";
	}

	logs(server: ServerRef): string {
		return this.ownerOf(server)?.logs(server) ?? "";
	}

	used(server: ServerRef): void {
		this.ownerOf(server)?.used(server);
	}

	async asleep(server: ServerRef): Promise<boolean> {
		return (await this.ownerOf(server)?.asleep(server)) ?? false;
	}

	private ownerOf(server: ServerRef): McpHost | undefined {
		return this.owners.get(server.name);
	}

	private hostOf(conf: ConnConfig): McpHost {
		const route = this.routes.find((candidate) => candidate.claims(conf));
		if (route === undefined)
			throw new Error(`${conf.name}: no host here can run it.`);
		return route.host;
	}
}
