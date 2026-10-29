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
	let announced = true;
	const sockets = new DesktopSockets({
		registry,
		authenticate: async (token) => (token === "good" ? user : null),
		announce: async (userId, machine) => {
			if (!announced) throw new Error("convex is down");
			return {
				userId,
				machineId: machine.id,
				connection: "c1",
			};
		},
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
	const peers = new Set<unknown>();
	const attach = registry.attach.bind(registry);
	const detach = registry.detach.bind(registry);
	vi.spyOn(registry, "attach").mockImplementation((userId, machineId, peer) => {
		peers.add(peer);
		attach(userId, machineId, peer);
	});
	vi.spyOn(registry, "detach").mockImplementation((peer) => {
		peers.delete(peer);
		detach(peer);
	});
	const attached = () => peers.size > 0;
	const failAnnounce = () => {
		announced = false;
	};
	return {
		registry,
		sockets,
		socket,
		say,
		pass,
		withdrawn,
		attached,
		failAnnounce,
	};
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

	it("withdraws every desktop's presence when the server shuts down", async () => {
		const { sockets, socket, say, withdrawn, attached } = world();
		await say({
			type: "auth",
			token: "good",
			version: PROTOCOL_VERSION,
			machine: MACHINE,
		});
		await sockets.closeAll();
		expect(withdrawn).toEqual([
			{ userId: user, machineId: MACHINE.id, connection: "c1" },
		]);
		expect(attached()).toBe(false);
		expect(socket.closed).toBe(1012);
	});

	it("drops a desktop that went silent and withdraws its presence", async () => {
		const { sockets, socket, say, pass, withdrawn, attached } = world();
		await say({
			type: "auth",
			token: "good",
			version: PROTOCOL_VERSION,
			machine: MACHINE,
		});
		expect(attached()).toBe(true);
		pass(SILENT_FOR_TOO_LONG_MS + 1);
		sockets.sweep();
		await vi.waitFor(() =>
			expect(withdrawn).toEqual([
				{ userId: user, machineId: MACHINE.id, connection: "c1" },
			]),
		);
		expect(socket.closed).toBe(4408);
		expect(attached()).toBe(false);
	});

	it("keeps a desktop that keeps pinging", async () => {
		const { sockets, socket, say, pass, attached } = world();
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
		expect(attached()).toBe(true);
	});

	it("closes a desktop whose presence could not be recorded, so the bar and the agent never disagree", async () => {
		const { socket, say, attached, failAnnounce } = world();
		failAnnounce();
		await say({
			type: "auth",
			token: "good",
			version: PROTOCOL_VERSION,
			machine: MACHINE,
		});
		expect(socket.sent).toEqual([]);
		expect(socket.closed).toBe(1011);
		expect(attached()).toBe(false);
	});
});
