import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

export interface Opened {
	readonly transport: Transport;
	release(): Promise<void>;
}

export type Opener = (exited: (error: string) => void) => Promise<Opened>;

export interface LocalServerEvents {
	message(message: unknown): void;
	exited(error?: string): void;
}

export class LocalServer {
	private opened: Opened | undefined;
	private stopping = false;
	private failure: string | undefined;

	constructor(
		private readonly open: Opener,
		private readonly events: LocalServerEvents,
	) {}

	async start(): Promise<void> {
		const opened = await this.open((error) => this.end(error));
		this.opened = opened;
		if (this.stopping) {
			await opened.release().catch(() => {});
			throw new Error("it was stopped before it finished starting");
		}
		opened.transport.onmessage = (message) => this.events.message(message);
		opened.transport.onerror = (error) => {
			this.failure = String(error);
		};
		opened.transport.onclose = () => this.end(this.failure);
		await opened.transport.start();
	}

	send(message: unknown): Promise<void> {
		if (this.opened === undefined)
			return Promise.reject(new Error("the server is not open"));
		return this.opened.transport.send(message as JSONRPCMessage);
	}

	async stop(): Promise<void> {
		this.stopping = true;
		await this.opened?.transport.close().catch(() => {});
		await this.opened?.release().catch(() => {});
	}

	private end(error?: string): void {
		if (this.stopping) return;
		this.stopping = true;
		void this.opened?.release().catch(() => {});
		this.events.exited(error);
	}
}
