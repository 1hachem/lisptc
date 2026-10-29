import type {
	ConnConfig,
	McpHost,
	McpTransport,
	ServerHandle,
	ServerState,
	StdioConnConfig,
} from "@repo/mcp-extension/ports";
import type { DesktopPreferences } from "@repo/preferences-extension/ports";
import type { Id } from "../convex/_generated/dataModel.js";

export interface LocalServer {
	readonly name: string;
	readonly command: string;
	readonly args: readonly string[];
	readonly env: Readonly<Record<string, string>>;
}

export interface Desktop {
	connected(): boolean;
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

	async ensure(conf: ConnConfig): Promise<ServerHandle | undefined> {
		const local = localServer(conf);
		if (local === undefined) return this.fallback.ensure(conf);
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
		return this.opened.has(name) ? "running" : this.fallback.status(name);
	}

	logs(name: string): string {
		return this.opened.has(name) ? "" : this.fallback.logs(name);
	}
}
