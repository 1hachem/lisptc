import type { McpTransport, ServerReport } from "@repo/mcp-extension/ports";
import { describe, expect, it } from "vitest";
import {
	BridgedHost,
	type Desktop,
	type LocalServer,
} from "../src/desktop-bridge.ts";

function channel(): McpTransport & { end(error?: Error): void } {
	const transport: McpTransport & { end(error?: Error): void } = {
		start: async () => {},
		send: async () => {},
		close: async () => {
			transport.onclose?.();
		},
		end(error) {
			if (error) transport.onerror?.(error);
			transport.onclose?.();
		},
	};
	return transport;
}

function bridge(): Desktop & {
	opened: LocalServer[];
	channels: ReturnType<typeof channel>[];
} {
	const opened: LocalServer[] = [];
	const channels: ReturnType<typeof channel>[] = [];
	return {
		opened,
		channels,
		open: async (server) => {
			opened.push(server);
			const opening = channel();
			channels.push(opening);
			return opening;
		},
		close: async () => {},
		connected: () => true,
		running: () => true,
		settings: async () => undefined,
	};
}

const fs = { name: "fs", command: "npx", args: ["fs-mcp"], local: true };

async function connected(host: BridgedHost) {
	const handle = await host.ensure(fs);
	if (!("transport" in handle)) throw new Error("expected a transport");
	const transport = handle.transport();
	await transport.start();
	return transport;
}

describe("BridgedHost", () => {
	it("opens a :local command server on the owner's desktop", async () => {
		const desktop = bridge();
		const host = new BridgedHost(desktop);

		await connected(host);

		expect(desktop.opened).toEqual([
			{ name: "fs", command: "npx", args: ["fs-mcp"], env: {} },
		]);
		expect(host.status({ name: "fs" })).toBe("running");
	});

	it("reports a bridged server stopped once the desktop no longer runs it", async () => {
		const desktop = bridge();
		const alive = { value: true };
		desktop.running = () => alive.value;
		const host = new BridgedHost(desktop);
		await connected(host);

		alive.value = false;

		expect(host.status({ name: "fs" })).toBe("stopped");
	});

	it("refuses a server that does not run on the desktop", async () => {
		const host = new BridgedHost(bridge());

		await expect(
			host.ensure({ name: "plain", command: "npx" }),
		).rejects.toThrow(/does not run on the desktop/);
	});

	it("reports a server starting, ready, then asleep once stopped", async () => {
		const reports: ServerReport[] = [];
		const host = new BridgedHost(bridge(), (r) => reports.push(r));
		await connected(host);

		await host.stop({ name: "fs" });

		expect(reports).toEqual([
			{ server: "fs", phase: "starting" },
			{ server: "fs", phase: "ready" },
			{ server: "fs", phase: "sleeping" },
		]);
		expect(host.status({ name: "fs" })).toBe("unknown");
	});

	it("reports a server failed when it exits on the desktop", async () => {
		const desktop = bridge();
		const reports: ServerReport[] = [];
		const host = new BridgedHost(desktop, (r) => reports.push(r));
		await connected(host);

		desktop.channels[0]?.end(new Error('"fs" exited on the desktop'));

		expect(reports.at(-1)).toEqual({
			server: "fs",
			phase: "failed",
			reason: '"fs" exited on the desktop',
		});
		expect(host.status({ name: "fs" })).toBe("unknown");
	});

	it("reports the bridge's refusal when no desktop is connected", async () => {
		const reports: ServerReport[] = [];
		const host = new BridgedHost(
			{
				open: async () => {
					throw new Error("no desktop connected for this user");
				},
				close: async () => {},
				connected: () => false,
				running: () => true,
				settings: async () => undefined,
			},
			(r) => reports.push(r),
		);

		await expect(host.ensure(fs)).rejects.toThrow(
			"no desktop connected for this user",
		);
		expect(reports).toEqual([
			{
				server: "fs",
				phase: "failed",
				reason: "no desktop connected for this user",
			},
		]);
	});
});
