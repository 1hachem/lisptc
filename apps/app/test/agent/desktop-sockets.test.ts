import type { Id } from "@repo/backend/dataModel";
import {
	PROTOCOL_VERSION,
	type ServerMessage,
	SILENT_FOR_TOO_LONG_MS,
} from "@repo/desktop-protocol";
import { describe, expect, it, vi } from "vitest";
import { DesktopRegistry } from "../../server/desktop/registry.ts";
import {
	type DesktopSocket,
	DesktopSockets,
	type Presence,
} from "../../server/desktop/sockets.ts";

const user = "user-1" as Id<"users">;
const MACHINE = { id: "m1", label: "laptop" };

function world() {
	let clock = 0;
	const registry = new DesktopRegistry();
	const withdrawn: Presence[] = [];
	const sockets = new DesktopSockets({
		registry,
		authenticate: async (token) => (token === "good" ? user : null),
		announce: async (userId, machine) => ({
			userId,
			machineId: machine.id,
			connection: "c1",
		}),
		seen: async () => {},
		withdraw: async (presence) => {
			withdrawn.push(presence);
		},
		now: () => clock,
	});
	const socket: DesktopSocket & {
		sent: ServerMessage[];
		closed?: number;
	} = {
		sent: [],
		send(data) {
			socket.sent.push(JSON.parse(data) as ServerMessage);
		},
		close(code) {
			socket.closed = code ?? 1000;
		},
	};
	const say = (message: object) =>
		sockets.message(socket, JSON.stringify(message));
	const pass = (ms: number) => {
		clock += ms;
	};
	return { registry, sockets, socket, say, pass, withdrawn };
}

describe("the desktop socket", () => {
	it("answers a ping with a pong", async () => {
		const { socket, say } = world();
		await say({
			type: "auth",
			token: "good",
			version: PROTOCOL_VERSION,
			machine: MACHINE,
		});
		await say({ type: "ping" });
		expect(socket.sent).toEqual([{ type: "welcome" }, { type: "pong" }]);
	});

	it("tells an older desktop to upgrade", async () => {
		const { socket, say } = world();
		await say({ type: "auth", token: "good", version: 2, machine: MACHINE });
		expect(socket.sent).toEqual([
			{ type: "upgrade", version: PROTOCOL_VERSION },
		]);
		expect(socket.closed).toBe(4426);
	});

	it("drops a desktop that went silent and withdraws its presence", async () => {
		const { registry, sockets, socket, say, pass, withdrawn } = world();
		await say({
			type: "auth",
			token: "good",
			version: PROTOCOL_VERSION,
			machine: MACHINE,
		});
		expect(registry.connected(user)).toBe(true);
		pass(SILENT_FOR_TOO_LONG_MS + 1);
		sockets.sweep();
		await vi.waitFor(() =>
			expect(withdrawn).toEqual([
				{ userId: user, machineId: MACHINE.id, connection: "c1" },
			]),
		);
		expect(socket.closed).toBe(4408);
		expect(registry.connected(user)).toBe(false);
	});

	it("keeps a desktop that keeps pinging", async () => {
		const { registry, sockets, socket, say, pass } = world();
		await say({
			type: "auth",
			token: "good",
			version: PROTOCOL_VERSION,
			machine: MACHINE,
		});
		for (let beat = 0; beat < 5; beat += 1) {
			pass(SILENT_FOR_TOO_LONG_MS - 1);
			await say({ type: "ping" });
			sockets.sweep();
		}
		expect(socket.closed).toBeUndefined();
		expect(registry.connected(user)).toBe(true);
	});
});
