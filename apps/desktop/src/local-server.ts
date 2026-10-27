import { randomUUID } from "node:crypto";
import {
	getDefaultEnvironment,
	StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

export interface LocalServerSpec {
	readonly name: string;
	readonly command: string;
	readonly args: readonly string[];
	readonly env: Readonly<Record<string, string>>;
}

export class LocalServer {
	private readonly stdio: StdioClientTransport;
	private readonly http = new WebStandardStreamableHTTPServerTransport({
		sessionIdGenerator: () => randomUUID(),
	});

	constructor(readonly spec: LocalServerSpec) {
		this.stdio = new StdioClientTransport({
			command: spec.command,
			args: [...spec.args],
			env: { ...getDefaultEnvironment(), ...spec.env },
			stderr: "inherit",
		});
		this.stdio.onmessage = (message) => {
			void this.http.send(message);
		};
		this.http.onmessage = (message) => {
			void this.stdio.send(message);
		};
	}

	async start(): Promise<void> {
		await this.stdio.start();
		await this.http.start();
	}

	handle(request: Request): Promise<Response> {
		return this.http.handleRequest(request);
	}

	async stop(): Promise<void> {
		await Promise.allSettled([this.http.close(), this.stdio.close()]);
	}
}
