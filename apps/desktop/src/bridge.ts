import {
	type DesktopMessage,
	type DesktopSettings,
	type Machine,
	PING_EVERY_MS,
	PROTOCOL_VERSION,
	type ServerMessage,
	SILENT_FOR_TOO_LONG_MS,
} from "@repo/desktop-protocol";
import { session } from "electron";
import { LocalServer } from "./local-server.ts";

const MIN_RETRY_MS = 1_000;
const MAX_RETRY_MS = 30_000;

async function sessionToken(origin: string): Promise<string | undefined> {
	const response = await session.defaultSession
		.fetch(new URL("/api/auth/convex/token", origin).href)
		.catch(() => undefined);
	if (response === undefined || !response.ok) return undefined;
	const body = (await response.json().catch(() => null)) as {
		token?: unknown;
	} | null;
	return typeof body?.token === "string" ? body.token : undefined;
}

function socketUrl(origin: string): string {
	const url = new URL("/api/desktop", origin);
	url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
	return url.href;
}

export class DesktopBridge {
	private readonly servers = new Map<string, LocalServer>();
	private socket: WebSocket | undefined;
	private retryMs = MIN_RETRY_MS;
	private stopped = false;
	private paused = false;
	private heardAt = 0;
	private pinging: ReturnType<typeof setInterval> | undefined;

	constructor(
		readonly origin: string,
		private readonly settings: (change: unknown) => DesktopSettings,
		private readonly outdated: () => Promise<void>,
		private readonly machine: Machine,
	) {}

	start(): void {
		void this.connect();
	}

	pause(): void {
		this.paused = true;
		this.socket?.close();
	}

	resume(): void {
		if (!this.paused || this.stopped) return;
		this.paused = false;
		this.retryMs = MIN_RETRY_MS;
		if (this.socket === undefined) void this.connect();
	}

	async stop(): Promise<void> {
		this.stopped = true;
		this.socket?.close();
		const servers = [...this.servers.values()];
		this.servers.clear();
		await Promise.all(servers.map((server) => server.stop()));
	}

	private retry(): void {
		if (this.stopped || this.paused) return;
		setTimeout(() => void this.connect(), this.retryMs);
		this.retryMs = Math.min(this.retryMs * 2, MAX_RETRY_MS);
	}

	private async connect(): Promise<void> {
		if (this.stopped || this.paused) return;
		const token = await sessionToken(this.origin);
		if (token === undefined) return this.retry();
		const socket = new WebSocket(socketUrl(this.origin));
		this.socket = socket;
		socket.addEventListener("open", () => {
			this.send({
				type: "auth",
				token,
				version: PROTOCOL_VERSION,
				machine: this.machine,
			});
		});
		socket.addEventListener("message", (event) => {
			this.heardAt = Date.now();
			if (typeof event.data !== "string") return;
			void this.receive(JSON.parse(event.data) as ServerMessage);
		});
		socket.addEventListener("close", () => {
			if (this.socket !== socket) return;
			this.socket = undefined;
			this.stopPinging();
			this.retry();
		});
	}

	private startPinging(): void {
		this.stopPinging();
		this.heardAt = Date.now();
		this.pinging = setInterval(() => {
			if (Date.now() - this.heardAt > SILENT_FOR_TOO_LONG_MS) {
				this.socket?.close();
				return;
			}
			this.send({ type: "ping" });
		}, PING_EVERY_MS);
	}

	private stopPinging(): void {
		clearInterval(this.pinging);
		this.pinging = undefined;
	}

	private send(message: DesktopMessage): void {
		this.socket?.send(JSON.stringify(message));
	}

	private async receive(message: ServerMessage): Promise<void> {
		switch (message.type) {
			case "welcome":
				this.retryMs = MIN_RETRY_MS;
				this.startPinging();
				return;
			case "pong":
				return;
			case "upgrade":
				this.stopped = true;
				await this.outdated();
				return;
			case "settings":
				this.send({
					type: "settings",
					id: message.id,
					...this.settings(message.change),
				});
				return;
			case "open":
				return this.open(message);
			case "rpc":
				await this.servers
					.get(message.server)
					?.send(message.message)
					.catch((error: unknown) =>
						this.exited(message.server, String(error)),
					);
				return;
			case "close": {
				const server = this.servers.get(message.name);
				this.servers.delete(message.name);
				await server?.stop();
				return;
			}
		}
	}

	private async open(
		message: Extract<ServerMessage, { type: "open" }>,
	): Promise<void> {
		const { id, ...spec } = message;
		await this.servers.get(spec.name)?.stop();
		this.servers.delete(spec.name);
		const server = new LocalServer(spec, {
			message: (payload) =>
				this.send({ type: "rpc", server: spec.name, message: payload }),
			exited: (error) => this.exited(spec.name, error, server),
		});
		try {
			await server.start();
			this.servers.set(spec.name, server);
			this.send({ type: "opened", id, ok: true });
		} catch (error) {
			await server.stop();
			this.send({
				type: "opened",
				id,
				ok: false,
				error: `could not start "${spec.name}": ${String(error)}`,
			});
		}
	}

	private exited(name: string, error?: string, server?: LocalServer): void {
		if (server !== undefined && this.servers.get(name) !== server) return;
		this.servers.delete(name);
		this.send({
			type: "exited",
			server: name,
			...(error === undefined ? {} : { error }),
		});
	}
}
