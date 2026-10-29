import type {
	ConnConfig,
	McpHost,
	McpTransport,
	ServerHandle,
	ServerState,
	StartWatch,
	StdioConnConfig,
} from "@repo/mcp-extension/ports";
import type { DesktopPreferences } from "@repo/shared/desktop";
import type { Id } from "../convex/_generated/dataModel.js";

export interface LocalServer {
	readonly name: string;
	readonly command: string;
	readonly args: readonly string[];
	readonly env: Readonly<Record<string, string>>;
}

export interface Desktop {
	connected(): boolean;
	running(name: string): boolean;
	open(server: LocalServer): Promise<McpTransport>;
	close(name: string): Promise<void>;
	settings(
		change: Partial<DesktopPreferences>,
	): Promise<DesktopPreferences | undefined>;
}

export type DesktopFor = (userId: Id<"users">) => Desktop;

function localServer(conf: ConnConfig): StdioConnConfig | undefined {
	if ("url" in conf || "image" in conf) return undefined;
	return conf.local === true ? conf : undefined;
}

export class BridgedHost implements McpHost {
	private readonly opened = new Set<string>();

	constructor(
		private readonly desktop: Desktop,
		private readonly fallback: McpHost,
	) {}

	async ensure(
		conf: ConnConfig,
		watch?: StartWatch,
	): Promise<ServerHandle | undefined> {
		const local = localServer(conf);
		if (local === undefined) return this.fallback.ensure(conf, watch);
		const channel = await this.desktop.open({
			name: local.name,
			command: local.command,
			args: local.args ?? [],
			env: local.env ?? {},
		});
		this.opened.add(local.name);
		return { transport: () => channel };
	}

	async stop(name: string): Promise<void> {
		if (!this.opened.delete(name)) return this.fallback.stop(name);
		await this.desktop.close(name);
	}

	async stopAll(): Promise<void> {
		const names = [...this.opened];
		this.opened.clear();
		await Promise.all([
			...names.map((name) => this.desktop.close(name)),
			this.fallback.stopAll(),
		]);
	}

	status(name: string): ServerState {
		if (!this.opened.has(name)) return this.fallback.status(name);
		return this.desktop.running(name) ? "running" : "stopped";
	}

	logs(name: string): string {
		return this.opened.has(name) ? "" : this.fallback.logs(name);
	}

	used(name: string): void {
		if (!this.opened.has(name)) this.fallback.used(name);
	}

	async asleep(name: string): Promise<boolean> {
		return this.opened.has(name) ? false : this.fallback.asleep(name);
	}
}
