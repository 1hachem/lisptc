import {
	getDefaultEnvironment,
	StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { localServerEnv } from "@repo/env/desktop";

export interface LocalServerSpec {
	readonly name: string;
	readonly command: string;
	readonly args: readonly string[];
	readonly env: Readonly<Record<string, string>>;
}

export interface LocalServerEvents {
	message(message: unknown): void;
	exited(error?: string): void;
}

export class LocalServer {
	private readonly stdio: StdioClientTransport;
	private stopping = false;

	constructor(
		readonly spec: LocalServerSpec,
		events: LocalServerEvents,
	) {
		this.stdio = new StdioClientTransport({
			command: spec.command,
			args: [...spec.args],
			env: { ...getDefaultEnvironment(), ...localServerEnv, ...spec.env },
			stderr: "inherit",
		});
		let failure: string | undefined;
		this.stdio.onmessage = (message) => events.message(message);
		this.stdio.onerror = (error) => {
			failure = String(error);
		};
		this.stdio.onclose = () => {
			if (!this.stopping) events.exited(failure);
		};
	}

	start(): Promise<void> {
		return this.stdio.start();
	}

	send(message: unknown): Promise<void> {
		return this.stdio.send(message as JSONRPCMessage);
	}

	async stop(): Promise<void> {
		this.stopping = true;
		await this.stdio.close().catch(() => {});
	}
}
