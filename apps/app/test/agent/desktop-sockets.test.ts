import type { Id } from "@repo/backend/dataModel";
import {
	PROTOCOL_VERSION,
	type ServerMessage,
	SILENT_FOR_TOO_LONG_MS,
} from "@repo/desktop-protocol";
import { describe, expect, it } from "vitest";
import { DesktopRegistry } from "../../server/desktop/registry.ts";
import {
	type DesktopSocket,
	DesktopSockets,
} from "../../server/desktop/sockets.ts";

const user = "user-1" as Id<"users">;
const MACHINE = { id: "m1", label: "laptop" };

function world() {
	let clock = 0;
	const registry = new DesktopRegistry();
	const sockets = new DesktopSockets({
		registry,
		authenticate: async (token) => (token === "good" ? user : null),
		announce: async (userId, machine) => ({
			userId,
			machineId: machine.id,
			connection: "c1",
		}),
		seen: async () => {},
		withdraw: async () => {},
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
	const signIn = () =>
		say({
			type: "auth",
			token: "good",
			version: PROTOCOL_VERSION,
			machine: MACHINE,
		});
	return { registry, sockets, socket, say, signIn, pass };
}

describe("the desktop socket", () => {
	it("tells an older desktop to upgrade", async () => {
		const { socket, say } = world();
		await say({ type: "auth", token: "good", version: 2, machine: MACHINE });
		expect(socket.sent).toEqual([
			{ type: "upgrade", version: PROTOCOL_VERSION },
		]);
		expect(socket.closed).toBe(4426);
	});

	it("closes every desktop as offline when the server shuts down", async () => {
		const { registry, sockets, socket, signIn } = world();
		await signIn();
		await sockets.closeAll();
		expect(socket.closed).toBe(1012);
		expect(registry.for(user).connected()).toBe(false);
	});

	it("closes a desktop that went silent and counts it offline", async () => {
		const { registry, sockets, socket, signIn, pass } = world();
		await signIn();
		pass(SILENT_FOR_TOO_LONG_MS + 1);
		sockets.sweep();
		expect(socket.closed).toBe(4408);
		expect(registry.for(user).connected()).toBe(false);
	});

	it("keeps a desktop that keeps pinging", async () => {
		const { registry, sockets, socket, say, signIn, pass } = world();
		await signIn();
		for (let beat = 0; beat < 5; beat += 1) {
			pass(SILENT_FOR_TOO_LONG_MS - 1);
			await say({ type: "ping" });
			sockets.sweep();
		}
		expect(socket.closed).toBeUndefined();
		expect(registry.for(user).connected()).toBe(true);
	});
});
