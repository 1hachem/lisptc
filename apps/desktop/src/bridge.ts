import {
	type DesktopMessage,
	type DesktopSettings,
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
	private readonly reading = new Map<
		string,
		ReadableStreamDefaultReader<Uint8Array>
	>();
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
			this.send({ type: "auth", token, version: PROTOCOL_VERSION });
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
			for (const reader of this.reading.values()) void reader.cancel();
			this.reading.clear();
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
			case "request":
				return this.request(message);
			case "cancel":
				await this.reading.get(message.id)?.cancel();
				this.reading.delete(message.id);
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
		if (this.servers.has(spec.name)) {
			this.send({ type: "opened", id, ok: true });
			return;
		}
		const server = new LocalServer(spec);
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

	private async request(
		message: Extract<ServerMessage, { type: "request" }>,
	): Promise<void> {
		const { id } = message;
		const server = this.servers.get(message.server);
		if (server === undefined) {
			this.send({
				type: "fail",
				id,
				error: `"${message.server}" is not running on the desktop`,
			});
			return;
		}
		try {
			const response = await server.handle(
				new Request(new URL(message.path, "http://desktop.bridge"), {
					method: message.method,
					headers: message.headers,
					...(message.body === undefined ? {} : { body: message.body }),
				}),
			);
			this.send({
				type: "response",
				id,
				status: response.status,
				headers: Object.fromEntries(response.headers),
			});
			if (response.body === null) return this.send({ type: "end", id });
			const reader = response.body.getReader();
			this.reading.set(id, reader);
			const decoder = new TextDecoder();
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				this.send({
					type: "chunk",
					id,
					data: decoder.decode(value, { stream: true }),
				});
			}
			this.reading.delete(id);
			this.send({ type: "end", id });
		} catch (error) {
			this.reading.delete(id);
			this.send({ type: "fail", id, error: String(error) });
		}
	}
}
