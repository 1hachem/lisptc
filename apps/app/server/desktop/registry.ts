import type { Id } from "@repo/backend/dataModel";
import type { Desktop, LocalServer } from "@repo/backend/desktop-bridge";
import type {
	DesktopMessage,
	DesktopSettings,
	ServerMessage,
} from "@repo/desktop-protocol";
import type { McpTransport } from "@repo/mcp-extension/ports";

export interface DesktopPeer {
	send(text: string): void;
	close(): void;
}

interface Waiting {
	resolve(): void;
	reject(error: Error): void;
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

class Channel implements McpTransport {
	onmessage?: (message: unknown) => void;
	onclose?: () => void;
	onerror?: (error: Error) => void;
	private ended = false;

	constructor(
		private readonly connection: Connection,
		readonly server: string,
	) {}

	async start(): Promise<void> {}

	async send(message: unknown): Promise<void> {
		if (this.ended || this.connection.dropped) throw noDesktop(this.server);
		this.connection.send({ type: "rpc", server: this.server, message });
	}

	async close(): Promise<void> {
		if (this.ended) return;
		this.connection.forget(this);
		this.connection.send({ type: "close", name: this.server });
		this.end();
	}

	end(error?: Error): void {
		if (this.ended) return;
		this.ended = true;
		if (error !== undefined) this.onerror?.(error);
		this.onclose?.();
	}
}

class Connection {
	readonly opening = new Map<string, Waiting>();
	readonly settling = new Map<string, Settling>();
	readonly channels = new Map<string, Channel>();
	dropped = false;

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
			case "rpc":
				this.channels.get(message.server)?.onmessage?.(message.message);
				return;
			case "exited": {
				const channel = this.channels.get(message.server);
				if (channel === undefined) return;
				this.channels.delete(message.server);
				channel.end(
					new Error(
						message.error ?? `"${message.server}" exited on the desktop`,
					),
				);
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
		this.dropped = true;
		for (const waiting of this.opening.values()) waiting.reject(reason);
		for (const settling of this.settling.values()) settling.reject(reason);
		this.settling.clear();
		this.opening.clear();
		const channels = [...this.channels.values()];
		this.channels.clear();
		for (const channel of channels) channel.end(reason);
	}

	open(server: string): Channel {
		const channel = new Channel(this, server);
		const previous = this.channels.get(server);
		this.channels.set(server, channel);
		previous?.end();
		return channel;
	}

	forget(channel: Channel): void {
		if (this.channels.get(channel.server) === channel)
			this.channels.delete(channel.server);
	}

	shut(server: string): void {
		const channel = this.channels.get(server);
		this.channels.delete(server);
		this.send({ type: "close", name: server });
		channel?.end();
	}
}

interface Seat {
	readonly userId: Id<"users">;
	readonly machineId: string;
}

export class DesktopRegistry {
	private readonly connections = new Map<
		Id<"users">,
		Map<string, Connection>
	>();
	private readonly seats = new Map<DesktopPeer, Seat>();

	attach(userId: Id<"users">, machineId: string, peer: DesktopPeer): void {
		const machines =
			this.connections.get(userId) ?? new Map<string, Connection>();
		const previous = machines.get(machineId);
		if (previous !== undefined && previous.peer !== peer) {
			this.seats.delete(previous.peer);
			previous.drop(new Error("desktop reconnected"));
			previous.peer.close();
		}
		machines.delete(machineId);
		machines.set(machineId, new Connection(peer));
		this.connections.set(userId, machines);
		this.seats.set(peer, { userId, machineId });
	}

	receive(peer: DesktopPeer, message: DesktopMessage): void {
		const seat = this.seats.get(peer);
		if (seat === undefined) return;
		this.connections.get(seat.userId)?.get(seat.machineId)?.receive(message);
	}

	detach(peer: DesktopPeer): void {
		const seat = this.seats.get(peer);
		if (seat === undefined) return;
		this.seats.delete(peer);
		const machines = this.connections.get(seat.userId);
		const connection = machines?.get(seat.machineId);
		if (machines === undefined || connection?.peer !== peer) return;
		machines.delete(seat.machineId);
		if (machines.size === 0) this.connections.delete(seat.userId);
		connection.drop(new Error("desktop disconnected"));
	}

	for(userId: Id<"users">): Desktop {
		return {
			connected: () => this.connected(userId),
			open: (server) => this.open(userId, server),
			close: (name) => this.close(userId, name),
			settings: (change) => this.settings(userId, change),
		};
	}

	connected(userId: Id<"users">): boolean {
		return this.latest(userId) !== undefined;
	}

	private latest(userId: Id<"users">): Connection | undefined {
		const machines = this.connections.get(userId);
		if (machines === undefined) return undefined;
		return [...machines.values()].at(-1);
	}

	async open(userId: Id<"users">, server: LocalServer): Promise<McpTransport> {
		const connection = this.latest(userId);
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
		return connection.open(server.name);
	}

	async settings(
		userId: Id<"users">,
		change: Partial<DesktopSettings>,
	): Promise<DesktopSettings | undefined> {
		const connection = this.latest(userId);
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
		for (const connection of this.connections.get(userId)?.values() ?? [])
			connection.shut(name);
	}
}

const SHARED_ACROSS_SERVER_CHUNKS = Symbol.for("lisptc.desktop.registry");

type ProcessWide = { [SHARED_ACROSS_SERVER_CHUNKS]?: DesktopRegistry };

const processWide = globalThis as ProcessWide;

processWide[SHARED_ACROSS_SERVER_CHUNKS] ??= new DesktopRegistry();

export const desktops: DesktopRegistry =
	processWide[SHARED_ACROSS_SERVER_CHUNKS];
