import type { Id } from "@repo/backend/dataModel";
import { BridgedHost } from "@repo/backend/desktop-bridge";
import { PROTOCOL_VERSION, type ServerMessage } from "@repo/desktop-protocol";
import type { McpHost, McpTransport } from "@repo/mcp-extension/ports";
import { describe, expect, it } from "vitest";
import {
	type DesktopPeer,
	DesktopRegistry,
} from "../../server/desktop/registry.ts";
import { DesktopSockets } from "../../server/desktop/sockets.ts";

const user = "user-1" as Id<"users">;
const server = { name: "fs", command: "npx", args: ["fs-mcp"], env: {} };
const local = { ...server, local: true };

function fakeDesktop(registry: DesktopRegistry): DesktopPeer & {
	sent: ServerMessage[];
	closed: boolean;
} {
	const sent: ServerMessage[] = [];
	const peer = {
		sent,
		closed: false,
		send(text: string) {
			const message = JSON.parse(text) as ServerMessage;
			sent.push(message);
			queueMicrotask(() => answer(message));
		},
		close() {
			peer.closed = true;
		},
	};
	function answer(message: ServerMessage): void {
		if (message.type === "open")
			registry.receive(peer, { type: "opened", id: message.id, ok: true });
		if (message.type === "rpc")
			registry.receive(peer, {
				type: "rpc",
				server: message.server,
				message: { echo: message.message },
			});
	}
	return peer;
}

type Answer = (message: ServerMessage) => object | undefined;

const answering: Answer = (message) => {
	if (message.type === "open")
		return { type: "opened", id: message.id, ok: true };
	if (message.type === "rpc")
		return {
			type: "rpc",
			server: message.server,
			message: { echo: message.message },
		};
	return undefined;
};

const cluster: McpHost = {
	ensure: async () => undefined,
	stop: async () => {},
	stopAll: async () => {},
	status: () => "unknown",
	logs: () => "",
};

function wire(registry = new DesktopRegistry()) {
	const sockets = new DesktopSockets({
		registry,
		authenticate: async (token) => token as Id<"users">,
		announce: async (userId, machine) => ({
			userId,
			machineId: machine.id,
			connection: machine.id,
		}),
		seen: async () => {},
		withdraw: async () => {},
		now: () => 0,
	});
	async function connect(
		account: Id<"users">,
		machine = "m1",
		answer: Answer = answering,
	) {
		const desktop = {
			sent: [] as ServerMessage[],
			closed: false,
			send(data: string): void {
				const message = JSON.parse(data) as ServerMessage;
				desktop.sent.push(message);
				const reply = answer(message);
				if (reply !== undefined) queueMicrotask(() => void desktop.say(reply));
			},
			close(): void {
				desktop.closed = true;
			},
			say: (message: object): Promise<void> =>
				sockets.message(desktop, JSON.stringify(message)),
			leave: (): void => sockets.close(desktop),
			opens: (): number => desktop.sent.filter((m) => m.type === "open").length,
		};
		await desktop.say({
			type: "auth",
			token: account,
			version: PROTOCOL_VERSION,
			machine: { id: machine, label: machine },
		});
		return desktop;
	}
	return {
		connect,
		desktopFor: (account: Id<"users">) => registry.for(account),
		hostFor: (account: Id<"users">) =>
			new BridgedHost(registry.for(account), cluster),
	};
}

async function transportOf(host: McpHost): Promise<McpTransport> {
	const handle = await host.ensure(local);
	if (handle === undefined || !("transport" in handle))
		throw new Error("expected a transport handle");
	return handle.transport();
}

describe("the desktop registry", () => {
	it("stops reporting a server running once it exits or the desktop goes away", async () => {
		const registry = new DesktopRegistry();
		const peer = fakeDesktop(registry);
		registry.attach(user, "m1", peer);
		const desktop = registry.for(user);
		await desktop.open(server);
		expect(desktop.running("fs")).toBe(true);
		registry.receive(peer, { type: "exited", server: "fs" });
		expect(desktop.running("fs")).toBe(false);
		await desktop.open(server);
		registry.detach(peer);
		expect(desktop.running("fs")).toBe(false);
		expect(desktop.connected()).toBe(false);
	});

	it("refuses to open a server when the user has no desktop connected", async () => {
		await expect(new DesktopRegistry().open(user, server)).rejects.toThrow(
			"no desktop connected for this user",
		);
	});
});

describe("a desktop reached over its socket", () => {
	it("binds a desktop to one account, so another account's machine is never reached", async () => {
		const { connect, hostFor } = wire();
		const desktop = await connect(user);
		await expect(
			hostFor("user-2" as Id<"users">).ensure(local),
		).rejects.toThrow("no desktop connected for this user");
		expect(desktop.opens()).toBe(0);
		await transportOf(hostFor(user));
		expect(desktop.opens()).toBe(1);
	});

	it("tells the client when the server's process exits on the desktop", async () => {
		const { connect, hostFor } = wire();
		const desktop = await connect(user);
		const channel = await transportOf(hostFor(user));
		const errors: Error[] = [];
		let closed = false;
		channel.onerror = (error) => errors.push(error);
		channel.onclose = () => {
			closed = true;
		};
		await desktop.say({ type: "exited", server: "fs", error: "boom" });
		expect(errors.map((e) => e.message)).toEqual(["boom"]);
		expect(closed).toBe(true);
		await expect(channel.send({})).rejects.toThrow("no desktop connected");
	});

	it("closes every open channel when the desktop disconnects", async () => {
		const { connect, hostFor } = wire();
		const desktop = await connect(user);
		const channel = await transportOf(hostFor(user));
		let closed = false;
		channel.onclose = () => {
			closed = true;
		};
		desktop.leave();
		expect(closed).toBe(true);
	});

	it("passes the desktop's refusal to open a server through", async () => {
		const { connect, hostFor } = wire();
		await connect(user, "m1", (message) =>
			message.type === "open"
				? { type: "opened", id: message.id, ok: false, error: "user declined" }
				: undefined,
		);
		await expect(hostFor(user).ensure(local)).rejects.toThrow("user declined");
	});

	it("fails what is in flight when the desktop disconnects", async () => {
		const { connect, hostFor } = wire();
		const desktop = await connect(user, "m1", () => undefined);
		const opening = hostFor(user).ensure(local);
		desktop.leave();
		await expect(opening).rejects.toThrow("desktop disconnected");
	});

	it("knows whether a user's desktop is connected right now", async () => {
		const { connect, desktopFor } = wire();
		expect(desktopFor(user).connected()).toBe(false);
		const desktop = await connect(user);
		expect(desktopFor(user).connected()).toBe(true);
		desktop.leave();
		expect(desktopFor(user).connected()).toBe(false);
	});

	it("keeps the newest connection and closes the one it replaces", async () => {
		const { connect, hostFor } = wire();
		const first = await connect(user, "m1");
		const second = await connect(user, "m1");
		expect(first.closed).toBe(true);
		await transportOf(hostFor(user));
		expect(first.opens()).toBe(0);
		expect(second.opens()).toBe(1);
	});

	it("keeps two machines of one account side by side, and opens on the newest", async () => {
		const { connect, desktopFor, hostFor } = wire();
		const laptop = await connect(user, "laptop");
		const tower = await connect(user, "tower");
		expect(laptop.closed).toBe(false);
		expect(tower.closed).toBe(false);
		await transportOf(hostFor(user));
		expect(laptop.opens()).toBe(0);
		expect(tower.opens()).toBe(1);
		tower.leave();
		expect(desktopFor(user).connected()).toBe(true);
		await transportOf(hostFor(user));
		expect(laptop.opens()).toBe(1);
	});
});
