import type {
	ConnConfig,
	McpHost,
	ServerHandle,
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

	async stop(name: string): Promise<void> {
		await this.owners.get(name)?.stop(name);
	}

	async remove(conf: ConnConfig): Promise<void> {
		await this.hostOf(conf).remove(conf);
		this.owners.delete(conf.name);
	}

	async stopAll(): Promise<void> {
		await Promise.all(
			[...new Set(this.routes.map((route) => route.host))].map((host) =>
				host.stopAll(),
			),
		);
	}

	status(name: string): ServerState {
		return this.owners.get(name)?.status(name) ?? "unknown";
	}

	logs(name: string): string {
		return this.owners.get(name)?.logs(name) ?? "";
	}

	used(name: string): void {
		this.owners.get(name)?.used(name);
	}

	async asleep(name: string): Promise<boolean> {
		return (await this.owners.get(name)?.asleep(name)) ?? false;
	}

	private hostOf(conf: ConnConfig): McpHost {
		const route = this.routes.find((candidate) => candidate.claims(conf));
		if (route === undefined)
			throw new Error(`${conf.name}: no host here can run it.`);
		return route.host;
	}
}
