import type { Id } from "@repo/backend/dataModel";
import { DESKTOP_SEEN_REFRESH_MS } from "@repo/backend/limits";
import {
	type Machine,
	PROTOCOL_VERSION,
	parseDesktopMessage,
	type ServerMessage,
	SILENT_FOR_TOO_LONG_MS,
} from "@repo/desktop-protocol";
import type { DesktopPeer, DesktopRegistry } from "./registry.ts";

export interface DesktopSocket {
	send(data: string): unknown;
	close(code?: number, reason?: string): void;
}

export interface Presence {
	readonly userId: Id<"users">;
	readonly machineId: string;
	readonly connection: string;
}

export interface SocketPorts {
	readonly registry: Pick<DesktopRegistry, "attach" | "receive" | "detach">;
	authenticate(token: string): Promise<Id<"users"> | null>;
	announce(userId: Id<"users">, machine: Machine): Promise<Presence>;
	seen(presence: Presence): Promise<void>;
	withdraw(presence: Presence): Promise<void>;
	now(): number;
}

interface Live {
	readonly peer: DesktopPeer;
	heardAt: number;
	seenAt: number;
	presence?: Promise<Presence>;
}

function reply(socket: DesktopSocket, message: ServerMessage): void {
	socket.send(JSON.stringify(message));
}

export class DesktopSockets {
	private readonly live = new Map<DesktopSocket, Live>();

	constructor(private readonly ports: SocketPorts) {}

	async message(socket: DesktopSocket, text: string): Promise<void> {
		const entry = this.entry(socket);
		entry.heardAt = this.ports.now();
		const message = parseDesktopMessage(text);
		if (message === undefined) return;
		if (message.type === "ping") {
			reply(socket, { type: "pong" });
			this.refresh(entry);
			return;
		}
		if (entry.presence !== undefined) {
			this.ports.registry.receive(entry.peer, message);
			return;
		}
		if ("version" in message && message.version !== PROTOCOL_VERSION) {
			reply(socket, { type: "upgrade", version: PROTOCOL_VERSION });
			return socket.close(4426, "upgrade the desktop app");
		}
		if (message.type !== "auth") return socket.close(4401, "auth first");
		const userId = await this.ports.authenticate(message.token);
		if (userId === null) return socket.close(4401, "invalid token");
		this.ports.registry.attach(userId, message.machine.id, entry.peer);
		entry.presence = this.ports.announce(userId, message.machine);
		entry.seenAt = this.ports.now();
		reply(socket, { type: "welcome" });
	}

	close(socket: DesktopSocket): void {
		const entry = this.live.get(socket);
		if (entry === undefined) return;
		this.live.delete(socket);
		this.ports.registry.detach(entry.peer);
		void entry.presence?.then((presence) => this.ports.withdraw(presence));
	}

	sweep(): void {
		const deadline = this.ports.now() - SILENT_FOR_TOO_LONG_MS;
		for (const [socket, entry] of [...this.live])
			if (entry.heardAt < deadline) {
				this.close(socket);
				socket.close(4408, "desktop went silent");
			}
	}

	private entry(socket: DesktopSocket): Live {
		const known = this.live.get(socket);
		if (known !== undefined) return known;
		const now = this.ports.now();
		const entry: Live = {
			peer: {
				send: (text) => {
					socket.send(text);
				},
				close: () => socket.close(),
			},
			heardAt: now,
			seenAt: now,
		};
		this.live.set(socket, entry);
		return entry;
	}

	private refresh(entry: Live): void {
		const now = this.ports.now();
		if (entry.presence === undefined) return;
		if (now - entry.seenAt < DESKTOP_SEEN_REFRESH_MS) return;
		entry.seenAt = now;
		void entry.presence.then((presence) => this.ports.seen(presence));
	}
}
