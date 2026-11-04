import type {
	ConnConfig,
	McpHost,
	McpTransport,
	ServerState,
} from "@repo/mcp-extension/ports";
import { describe, expect, it } from "vitest";
import { BridgedHost, type Desktop } from "../src/desktop-bridge.ts";

function fallback(): McpHost {
	const running = new Set<string>();
	return {
		ensure: async (conf: ConnConfig) => {
			running.add(conf.name);
			return { url: `http://docker.test/${conf.name}` };
		},
		stop: async (name) => {
			running.delete(name);
		},
		stopAll: async () => {
			running.clear();
		},
		status: (name): ServerState => (running.has(name) ? "running" : "unknown"),
		logs: () => "docker log",
	};
}

const channel: McpTransport = {
	start: async () => {},
	send: async () => {},
	close: async () => {},
};

function bridge(): Desktop {
	const running = new Set<string>();
	return {
		open: async (server) => {
			running.add(server.name);
			return channel;
		},
		close: async (name) => {
			running.delete(name);
		},
		connected: () => true,
		running: (name) => running.has(name),
		settings: async () => undefined,
	};
}

describe("BridgedHost", () => {
	it("opens a :local command server on the owner's desktop", async () => {
		const desktop = bridge();
		const host = new BridgedHost(desktop, fallback());
		const handle = await host.ensure({
			name: "fs",
			command: "npx",
			args: ["fs-mcp"],
			local: true,
		});
		expect(handle && "transport" in handle && handle.transport()).toBe(channel);
		expect(desktop.running("fs")).toBe(true);
		expect(host.status("fs")).toBe("running");
	});

	it("reports a bridged server stopped once the desktop no longer runs it", async () => {
		const desktop = bridge();
		const alive = { value: true };
		desktop.running = () => alive.value;
		const host = new BridgedHost(desktop, fallback());
		await host.ensure({ name: "fs", command: "npx", local: true });
		expect(host.status("fs")).toBe("running");
		alive.value = false;
		expect(host.status("fs")).toBe("stopped");
	});

	it("leaves every other server to the fallback host", async () => {
		const desktop = bridge();
		const host = new BridgedHost(desktop, fallback());
		expect(await host.ensure({ name: "plain", command: "npx" })).toEqual({
			url: "http://docker.test/plain",
		});
		expect(
			await host.ensure({ name: "remote", url: "https://example.test/mcp" }),
		).toEqual({ url: "http://docker.test/remote" });
		expect(desktop.running("plain")).toBe(false);
	});

	it("closes a bridged server on the desktop and stops the rest on the fallback", async () => {
		const desktop = bridge();
		const host = new BridgedHost(desktop, fallback());
		await host.ensure({ name: "fs", command: "npx", local: true });
		await host.ensure({ name: "other", command: "npx" });
		expect(host.status("other")).toBe("running");
		await host.stop("fs");
		await host.stop("other");
		expect(desktop.running("fs")).toBe(false);
		expect(host.status("fs")).toBe("unknown");
		expect(host.status("other")).toBe("unknown");
	});

	it("passes the bridge's refusal through when no desktop is connected", async () => {
		const docker = fallback();
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
			docker,
		);
		await expect(
			host.ensure({
				name: "fs",
				command: "npx",
				args: ["fs-mcp"],
				local: true,
			}),
		).rejects.toThrow("no desktop connected for this user");
		expect(docker.status("fs")).toBe("unknown");
	});
});
