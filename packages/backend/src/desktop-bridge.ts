import type {
	ConnConfig,
	HandleFetch,
	McpHost,
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

export interface DesktopBridge {
	open(userId: Id<"users">, server: LocalServer): Promise<HandleFetch>;
	close(userId: Id<"users">, name: string): Promise<void>;
	settings(
		userId: Id<"users">,
		change: Partial<DesktopPreferences>,
	): Promise<DesktopPreferences | undefined>;
}

function localServer(conf: ConnConfig): StdioConnConfig | undefined {
	if ("url" in conf || "image" in conf) return undefined;
	return conf.local === true ? conf : undefined;
}

export class BridgedHost implements McpHost {
	private readonly opened = new Set<string>();

	constructor(
		private readonly owner: Id<"users">,
		private readonly bridge: DesktopBridge,
		private readonly fallback: McpHost,
	) {}

	async ensure(conf: ConnConfig): Promise<ServerHandle | undefined> {
		const local = localServer(conf);
		if (local === undefined) return this.fallback.ensure(conf);
		const fetch = await this.bridge.open(this.owner, {
			name: local.name,
			command: local.command,
			args: local.args ?? [],
			env: local.env ?? {},
		});
		this.opened.add(local.name);
		return {
			url: `http://desktop.bridge/${encodeURIComponent(local.name)}/mcp`,
			fetch,
		};
	}

	async stop(name: string): Promise<void> {
		if (!this.opened.delete(name)) return this.fallback.stop(name);
		await this.bridge.close(this.owner, name);
	}

	async stopAll(): Promise<void> {
		const names = [...this.opened];
		this.opened.clear();
		await Promise.all([
			...names.map((name) => this.bridge.close(this.owner, name)),
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
