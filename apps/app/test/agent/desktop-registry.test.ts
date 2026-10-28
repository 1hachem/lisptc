import type { Id } from "@repo/backend/dataModel";
import { BridgedHost } from "@repo/backend/desktop-bridge";
import type { ServerMessage } from "@repo/desktop-protocol";
import type { McpHost } from "@repo/mcp-extension/ports";
import { describe, expect, it, vi } from "vitest";
import {
	type DesktopPeer,
	DesktopRegistry,
} from "../../server/desktop/registry.ts";

const user = "user-1" as Id<"users">;
const server = { name: "fs", command: "npx", args: ["fs-mcp"], env: {} };

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

describe("the desktop registry", () => {
	it("refuses to open a server when the user has no desktop connected", async () => {
		await expect(new DesktopRegistry().open(user, server)).rejects.toThrow(
			"no desktop connected for this user",
		);
	});

	it("opens a server on the user's desktop and carries json-rpc both ways", async () => {
		const registry = new DesktopRegistry();
		const peer = fakeDesktop(registry);
		registry.attach(user, "m1", peer);
		const channel = await registry.open(user, server);
		const received: unknown[] = [];
		channel.onmessage = (message) => received.push(message);
		await channel.send({ jsonrpc: "2.0", id: 1, method: "ping" });
		await vi.waitFor(() => expect(received).toHaveLength(1));
		expect(received[0]).toEqual({
			echo: { jsonrpc: "2.0", id: 1, method: "ping" },
		});
		expect(peer.sent.map((m) => m.type)).toEqual(["open", "rpc"]);
		expect(peer.sent[1]).toMatchObject({ server: "fs" });
	});

	it("tells the client when the server's process exits on the desktop", async () => {
		const registry = new DesktopRegistry();
		const peer = fakeDesktop(registry);
		registry.attach(user, "m1", peer);
		const channel = await registry.open(user, server);
		const errors: Error[] = [];
		let closed = false;
		channel.onerror = (error) => errors.push(error);
		channel.onclose = () => {
			closed = true;
		};
		registry.receive(peer, { type: "exited", server: "fs", error: "boom" });
		expect(errors.map((e) => e.message)).toEqual(["boom"]);
		expect(closed).toBe(true);
		await expect(channel.send({})).rejects.toThrow("no desktop connected");
	});

	it("closes every open channel when the desktop disconnects", async () => {
		const registry = new DesktopRegistry();
		const peer = fakeDesktop(registry);
		registry.attach(user, "m1", peer);
		const channel = await registry.open(user, server);
		let closed = false;
		channel.onclose = () => {
			closed = true;
		};
		registry.detach(peer);
		expect(closed).toBe(true);
	});

	it("passes the desktop's refusal to open a server through", async () => {
		const registry = new DesktopRegistry();
		const peer: DesktopPeer = {
			send(text) {
				const message = JSON.parse(text) as ServerMessage;
				if (message.type !== "open") return;
				queueMicrotask(() =>
					registry.receive(peer, {
						type: "opened",
						id: message.id,
						ok: false,
						error: "user declined",
					}),
				);
			},
			close() {},
		};
		registry.attach(user, "m1", peer);
		await expect(registry.open(user, server)).rejects.toThrow("user declined");
	});

	it("fails what is in flight when the desktop disconnects", async () => {
		const registry = new DesktopRegistry();
		const silent: DesktopPeer = { send() {}, close() {} };
		registry.attach(user, "m1", silent);
		const opening = registry.open(user, server);
		registry.detach(silent);
		await expect(opening).rejects.toThrow("desktop disconnected");
	});

	it("knows whether a user's desktop is connected right now", () => {
		const registry = new DesktopRegistry();
		const peer: DesktopPeer = { send() {}, close() {} };
		expect(registry.connected(user)).toBe(false);
		registry.attach(user, "m1", peer);
		expect(registry.connected(user)).toBe(true);
		registry.detach(peer);
		expect(registry.connected(user)).toBe(false);
	});

	it("keeps the newest connection and closes the one it replaces", async () => {
		const registry = new DesktopRegistry();
		const first = fakeDesktop(registry);
		const second = fakeDesktop(registry);
		registry.attach(user, "m1", first);
		registry.attach(user, "m1", second);
		expect(first.closed).toBe(true);
		await registry.open(user, server);
		expect(first.sent).toEqual([]);
		expect(second.sent.map((m) => m.type)).toEqual(["open"]);
	});

	it("keeps two machines of one account side by side, and opens on the newest", async () => {
		const registry = new DesktopRegistry();
		const laptop = fakeDesktop(registry);
		const tower = fakeDesktop(registry);
		registry.attach(user, "laptop", laptop);
		registry.attach(user, "tower", tower);
		expect(laptop.closed).toBe(false);
		expect(tower.closed).toBe(false);
		await registry.open(user, server);
		expect(laptop.sent).toEqual([]);
		expect(tower.sent.map((m) => m.type)).toEqual(["open"]);
		registry.detach(tower);
		expect(registry.connected(user)).toBe(true);
		await registry.open(user, server);
		expect(laptop.sent.map((m) => m.type)).toEqual(["open"]);
	});

	it("shares one registry across every module instance", async () => {
		vi.resetModules();
		const first = await import("../../server/desktop/registry.ts");
		vi.resetModules();
		const second = await import("../../server/desktop/registry.ts");
		expect(first.desktops).toBe(second.desktops);
		const peer = fakeDesktop(first.desktops);
		first.desktops.attach(user, "m1", peer);
		expect(second.desktops.connected(user)).toBe(true);
		second.desktops.detach(peer);
		expect(first.desktops.connected(user)).toBe(false);
	});
});

describe("the bridge is the account's, not the window's", () => {
	const cluster: McpHost = {
		ensure: async () => undefined,
		stop: async () => {},
		stopAll: async () => {},
		status: () => "unknown",
		logs: () => "",
	};

	it("reaches the account's desktop for a chat driven from any client", async () => {
		const registry = new DesktopRegistry();
		const desktop = fakeDesktop(registry);
		registry.attach(user, "m1", desktop);
		const fromBrowser = new BridgedHost(user, registry, cluster);
		const fromWindow = new BridgedHost(user, registry, cluster);
		for (const host of [fromBrowser, fromWindow]) {
			const handle = await host.ensure({ ...server, local: true });
			expect(handle).not.toHaveProperty("url");
			if (handle === undefined || !("transport" in handle))
				throw new Error("expected a transport handle");
			const channel = handle.transport();
			const received: unknown[] = [];
			channel.onmessage = (message) => received.push(message);
			await channel.send("ping");
			await vi.waitFor(() => expect(received).toEqual([{ echo: "ping" }]));
		}
		expect(desktop.sent.filter((m) => m.type === "open")).toHaveLength(2);
	});

	it("never reaches another account's desktop", async () => {
		const registry = new DesktopRegistry();
		registry.attach("user-2" as Id<"users">, "m1", fakeDesktop(registry));
		await expect(
			new BridgedHost(user, registry, cluster).ensure({
				...server,
				local: true,
			}),
		).rejects.toThrow("no desktop connected for this user");
	});
});
