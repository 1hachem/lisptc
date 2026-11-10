import { runSpecFor } from "@repo/containers/launch";
import type { LocalServerSpec } from "@repo/desktop-protocol";
import type {
	ConnConfig,
	LocalConnConfig,
	McpHost,
	McpTransport,
	ServerHandle,
	ServerRef,
	ServerReporter,
	ServerState,
} from "@repo/mcp-extension/ports";
import {
	type ReportedTransport,
	reportedTransport,
} from "@repo/mcp-extension/reported-transport";
import type { DesktopPreferences } from "@repo/shared/desktop";
import type { Id } from "../convex/_generated/dataModel.js";

export interface Desktop {
	connected(): boolean;
	running(name: string): boolean;
	open(server: LocalServerSpec): Promise<McpTransport>;
	close(name: string): Promise<void>;
	settings(
		change: Partial<DesktopPreferences>,
	): Promise<DesktopPreferences | undefined>;
}

export type DesktopFor = (userId: Id<"users">) => Desktop;

export function desktopServer(conf: ConnConfig): conf is LocalConnConfig {
	if ("url" in conf) return false;
	return conf.local === true;
}

function specOf(conf: LocalConnConfig): LocalServerSpec {
	if (!("image" in conf))
		return {
			kind: "command",
			name: conf.name,
			command: conf.command,
			args: conf.args ?? [],
			env: conf.env ?? {},
		};
	const run = runSpecFor(conf);
	return {
		kind: "image",
		name: run.name,
		launch: run.launch,
		...(run.app ? { app: run.app } : {}),
		env: run.env ?? {},
	};
}

export class BridgedHost implements McpHost {
	private readonly opened = new Map<string, ReportedTransport>();

	constructor(
		private readonly desktop: Desktop,
		private readonly report: ServerReporter = () => {},
	) {}

	async ensure(conf: ConnConfig): Promise<ServerHandle> {
		if (!desktopServer(conf))
			throw new Error(`${conf.name}: does not run on the desktop.`);
		const { name } = conf;
		let channel: McpTransport;
		try {
			channel = await this.desktop.open(specOf(conf));
		} catch (ex) {
			this.report({
				server: name,
				phase: "failed",
				reason: ex instanceof Error ? ex.message : String(ex),
			});
			throw ex;
		}
		const opened = reportedTransport({ name }, channel, this.report, () => {
			if (this.opened.get(name) === opened) this.opened.delete(name);
		});
		this.opened.set(name, opened);
		return { transport: () => opened.transport };
	}

	async stop({ name }: ServerRef): Promise<void> {
		const opened = this.opened.get(name);
		if (opened === undefined) return;
		this.opened.delete(name);
		await opened.end();
	}

	async remove(conf: ConnConfig): Promise<void> {
		await this.stop(conf);
		this.report({ server: conf.name, phase: "gone" });
	}

	async stopAll(): Promise<void> {
		await Promise.all(
			[...this.opened.keys()].map((name) => this.stop({ name })),
		);
	}

	status({ name }: ServerRef): ServerState {
		if (!this.opened.has(name)) return "unknown";
		return this.desktop.running(name) ? "running" : "stopped";
	}

	logs(_server: ServerRef): string {
		return "";
	}

	used(_server: ServerRef): void {}

	async asleep(_server: ServerRef): Promise<boolean> {
		return false;
	}
}
