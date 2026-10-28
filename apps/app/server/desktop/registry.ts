import type { Id } from "@repo/backend/dataModel";
import type { DesktopBridge, LocalServer } from "@repo/backend/desktop-bridge";
import type {
	DesktopMessage,
	DesktopSettings,
	ServerMessage,
} from "@repo/desktop-protocol";

export interface DesktopPeer {
	send(text: string): void;
	close(): void;
}

interface Waiting {
	resolve(): void;
	reject(error: Error): void;
}

interface Streaming {
	resolve(response: Response): void;
	reject(error: Error): void;
	controller?: ReadableStreamDefaultController<Uint8Array>;
}

const OPEN_TIMEOUT_MS = 120_000;

function noDesktop(name: string): Error {
	return new Error(
		`no desktop connected for this user on this server: open or restart the lisptc desktop app, then run (load-mcp :name "${name}" ... :local t) again`,
	);
}

interface Settling {
	resolve(settings: DesktopSettings): void;
	reject(error: Error): void;
}

const SETTINGS_TIMEOUT_MS = 10_000;

class Connection {
	readonly opening = new Map<string, Waiting>();
	readonly settling = new Map<string, Settling>();
	readonly streams = new Map<string, Streaming>();

	constructor(readonly peer: DesktopPeer) {}

	send(message: ServerMessage): void {
		this.peer.send(JSON.stringify(message));
	}

	receive(message: DesktopMessage): void {
		switch (message.type) {
			case "opened": {
				const waiting = this.opening.get(message.id);
				this.opening.delete(message.id);
				if (message.ok) waiting?.resolve();
				else waiting?.reject(new Error(message.error ?? "desktop refused"));
				return;
			}
			case "response": {
				const stream = this.streams.get(message.id);
				if (stream === undefined) return;
				const body = new ReadableStream<Uint8Array>({
					start: (controller) => {
						stream.controller = controller;
					},
					cancel: () => {
						this.streams.delete(message.id);
						this.send({ type: "cancel", id: message.id });
					},
				});
				stream.resolve(
					new Response(nullBody(message.status) ? null : body, {
						status: message.status,
						headers: message.headers,
					}),
				);
				return;
			}
			case "chunk":
				this.streams
					.get(message.id)
					?.controller?.enqueue(new TextEncoder().encode(message.data));
				return;
			case "end":
				this.streams.get(message.id)?.controller?.close();
				this.streams.delete(message.id);
				return;
			case "fail": {
				const stream = this.streams.get(message.id);
				this.streams.delete(message.id);
				const error = new Error(message.error);
				if (stream?.controller) stream.controller.error(error);
				else stream?.reject(error);
				return;
			}
			case "settings": {
				const settling = this.settling.get(message.id);
				this.settling.delete(message.id);
				settling?.resolve({
					closeToTray: message.closeToTray,
					openAtLogin: message.openAtLogin,
				});
				return;
			}
			case "auth":
				return;
		}
	}

	drop(reason: Error): void {
		for (const waiting of this.opening.values()) waiting.reject(reason);
		for (const settling of this.settling.values()) settling.reject(reason);
		this.settling.clear();
		for (const stream of this.streams.values()) {
			if (stream.controller) stream.controller.error(reason);
			else stream.reject(reason);
		}
		this.opening.clear();
		this.streams.clear();
	}
}

function nullBody(status: number): boolean {
	return status === 204 || status === 205 || status === 304;
}

export class DesktopRegistry implements DesktopBridge {
	private readonly connections = new Map<Id<"users">, Connection>();
	private readonly owners = new Map<DesktopPeer, Id<"users">>();

	attach(userId: Id<"users">, peer: DesktopPeer): void {
		const previous = this.connections.get(userId);
		if (previous !== undefined && previous.peer !== peer) {
			this.owners.delete(previous.peer);
			previous.drop(new Error("desktop reconnected"));
			previous.peer.close();
		}
		this.connections.set(userId, new Connection(peer));
		this.owners.set(peer, userId);
	}

	receive(peer: DesktopPeer, message: DesktopMessage): void {
		const userId = this.owners.get(peer);
		if (userId === undefined) return;
		this.connections.get(userId)?.receive(message);
	}

	detach(peer: DesktopPeer): void {
		const userId = this.owners.get(peer);
		if (userId === undefined) return;
		this.owners.delete(peer);
		const connection = this.connections.get(userId);
		if (connection?.peer !== peer) return;
		this.connections.delete(userId);
		connection.drop(new Error("desktop disconnected"));
	}

	holds(userId: Id<"users">): boolean {
		return this.connections.has(userId);
	}

	async open(
		userId: Id<"users">,
		server: LocalServer,
	): Promise<(url: string | URL, init?: RequestInit) => Promise<Response>> {
		const connection = this.connections.get(userId);
		if (connection === undefined) throw noDesktop(server.name);
		const id = crypto.randomUUID();
		await new Promise<void>((resolve, reject) => {
			const timer = setTimeout(() => {
				connection.opening.delete(id);
				reject(new Error(`desktop did not open "${server.name}" in time`));
			}, OPEN_TIMEOUT_MS);
			connection.opening.set(id, {
				resolve: () => {
					clearTimeout(timer);
					resolve();
				},
				reject: (error) => {
					clearTimeout(timer);
					reject(error);
				},
			});
			connection.send({ type: "open", id, ...server });
		});
		return (url, init) => this.forward(userId, server.name, url, init);
	}

	async settings(
		userId: Id<"users">,
		change: Partial<DesktopSettings>,
	): Promise<DesktopSettings | undefined> {
		const connection = this.connections.get(userId);
		if (connection === undefined) return undefined;
		const id = crypto.randomUUID();
		return new Promise<DesktopSettings>((resolve, reject) => {
			const timer = setTimeout(() => {
				connection.settling.delete(id);
				reject(new Error("desktop did not answer about its settings in time"));
			}, SETTINGS_TIMEOUT_MS);
			connection.settling.set(id, {
				resolve: (settings) => {
					clearTimeout(timer);
					resolve(settings);
				},
				reject: (error) => {
					clearTimeout(timer);
					reject(error);
				},
			});
			connection.send({ type: "settings", id, change });
		});
	}

	async close(userId: Id<"users">, name: string): Promise<void> {
		this.connections.get(userId)?.send({ type: "close", name });
	}

	private async forward(
		userId: Id<"users">,
		name: string,
		url: string | URL,
		init?: RequestInit,
	): Promise<Response> {
		const connection = this.connections.get(userId);
		if (connection === undefined) throw noDesktop(name);
		const request = new Request(url, init);
		const body =
			request.method === "GET" || request.method === "HEAD"
				? undefined
				: await request.text();
		const id = crypto.randomUUID();
		const response = new Promise<Response>((resolve, reject) => {
			connection.streams.set(id, { resolve, reject });
		});
		request.signal.addEventListener("abort", () => {
			const stream = connection.streams.get(id);
			if (stream === undefined) return;
			connection.streams.delete(id);
			connection.send({ type: "cancel", id });
			const reason = new Error("aborted");
			if (stream.controller) stream.controller.error(reason);
			else stream.reject(reason);
		});
		connection.send({
			type: "request",
			id,
			server: name,
			method: request.method,
			path: new URL(request.url).pathname,
			headers: Object.fromEntries(request.headers),
			...(body === undefined ? {} : { body }),
		});
		return response;
	}
}

const SHARED_ACROSS_SERVER_CHUNKS = Symbol.for("lisptc.desktop.registry");

type ProcessWide = { [SHARED_ACROSS_SERVER_CHUNKS]?: DesktopRegistry };

const processWide = globalThis as ProcessWide;

processWide[SHARED_ACROSS_SERVER_CHUNKS] ??= new DesktopRegistry();

export const desktops: DesktopRegistry =
	processWide[SHARED_ACROSS_SERVER_CHUNKS];
