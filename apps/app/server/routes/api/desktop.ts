import type { Id } from "@repo/backend/dataModel";
import { defineWebSocketHandler } from "nitro";
import { attachDesktop } from "../../desktop/hello.ts";
import {
	PROTOCOL_VERSION,
	parseDesktopMessage,
	type ServerMessage,
} from "../../desktop/protocol.ts";
import { type DesktopPeer, desktops } from "../../desktop/registry.ts";

interface Socket {
	send(data: string): unknown;
	close(code?: number, reason?: string): void;
}

const peers = new WeakMap<Socket, DesktopPeer>();

function peerOf(socket: Socket): DesktopPeer {
	const known = peers.get(socket);
	if (known !== undefined) return known;
	const peer: DesktopPeer = {
		send: (text) => {
			socket.send(text);
		},
		close: () => socket.close(),
	};
	peers.set(socket, peer);
	return peer;
}

function reply(socket: Socket, message: ServerMessage): void {
	socket.send(JSON.stringify(message));
}

export default defineWebSocketHandler({
	async message(socket, raw) {
		const peer = peerOf(socket);
		const message = parseDesktopMessage(raw.text());
		if (message === undefined) return;
		if (desktops.attached(peer)) {
			desktops.receive(peer, message);
			return;
		}
		if (message.type !== "hello") return socket.close(4401, "hello first");
		if (message.version !== PROTOCOL_VERSION) {
			reply(socket, { type: "upgrade", version: PROTOCOL_VERSION });
			return socket.close(4426, "upgrade the desktop app");
		}
		const userId: Id<"users"> | null = await attachDesktop(message.token);
		if (userId === null) return socket.close(4401, "invalid token");
		desktops.attach(userId, peer);
		reply(socket, { type: "welcome" });
	},
	close(socket) {
		desktops.detach(peerOf(socket));
	},
});
