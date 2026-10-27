import type { Id } from "@repo/backend/dataModel";
import { describe, expect, it } from "vitest";
import type { ServerMessage } from "../../server/desktop/protocol.ts";
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
		if (message.type === "request") {
			registry.receive(peer, {
				type: "response",
				id: message.id,
				status: 200,
				headers: { "content-type": "text/event-stream" },
			});
			registry.receive(peer, { type: "chunk", id: message.id, data: "data: " });
			registry.receive(peer, {
				type: "chunk",
				id: message.id,
				data: message.body ?? "",
			});
			registry.receive(peer, { type: "end", id: message.id });
		}
	}
	return peer;
}

describe("the desktop registry", () => {
	it("refuses to open a server when the user has no desktop connected", async () => {
		await expect(new DesktopRegistry().open(user, server)).rejects.toThrow(
			"no desktop connected for this user",
		);
	});

	it("opens a server on the user's desktop and streams a request through it", async () => {
		const registry = new DesktopRegistry();
		const peer = fakeDesktop(registry);
		registry.attach(user, peer);
		const fetch = await registry.open(user, server);
		const response = await fetch("http://desktop.bridge/fs/mcp", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: '{"jsonrpc":"2.0"}',
		});
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe("text/event-stream");
		expect(await response.text()).toBe('data: {"jsonrpc":"2.0"}');
		expect(peer.sent.map((m) => m.type)).toEqual(["open", "request"]);
		expect(peer.sent[1]).toMatchObject({
			server: "fs",
			method: "POST",
			path: "/fs/mcp",
		});
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
		registry.attach(user, peer);
		await expect(registry.open(user, server)).rejects.toThrow("user declined");
	});

	it("fails what is in flight when the desktop disconnects", async () => {
		const registry = new DesktopRegistry();
		const silent: DesktopPeer = { send() {}, close() {} };
		registry.attach(user, silent);
		const opening = registry.open(user, server);
		registry.detach(silent);
		await expect(opening).rejects.toThrow("desktop disconnected");
	});

	it("keeps the newest connection and closes the one it replaces", async () => {
		const registry = new DesktopRegistry();
		const first = fakeDesktop(registry);
		const second = fakeDesktop(registry);
		registry.attach(user, first);
		registry.attach(user, second);
		expect(first.closed).toBe(true);
		await registry.open(user, server);
		expect(first.sent).toEqual([]);
		expect(second.sent.map((m) => m.type)).toEqual(["open"]);
	});
});
