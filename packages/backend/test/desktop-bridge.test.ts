import type {
	ConnConfig,
	McpHost,
	McpTransport,
	ServerState,
} from "@repo/mcp-extension/ports";
import { describe, expect, it } from "vitest";
import {
	BridgedHost,
	type Desktop,
	type LocalServer,
} from "../src/desktop-bridge.ts";

function fallback(): McpHost & { ensured: string[]; stopped: string[] } {
	const ensured: string[] = [];
	const stopped: string[] = [];
	return {
		ensured,
		stopped,
		ensure: async (conf: ConnConfig) => {
			ensured.push(conf.name);
			return undefined;
		},
		stop: async (name) => {
			stopped.push(name);
		},
		stopAll: async () => {},
		status: (): ServerState => "unknown",
		logs: () => "docker log",
	};
}

const channel: McpTransport = {
	start: async () => {},
	send: async () => {},
	close: async () => {},
};

function bridge(): Desktop & {
	opened: LocalServer[];
	closed: string[];
} {
	const opened: LocalServer[] = [];
	const closed: string[] = [];
	return {
		opened,
		closed,
		open: async (server) => {
			opened.push(server);
			return channel;
		},
		close: async (name) => {
			closed.push(name);
		},
		running: () => true,
		settings: async () => undefined,
	};
}

describe("BridgedHost", () => {
	it("opens a :local command server on the owner's desktop", async () => {
		const desktop = bridge();
		const docker = fallback();
		const host = new BridgedHost(desktop, docker);
		const handle = await host.ensure({
			name: "fs",
			command: "npx",
			args: ["fs-mcp"],
			local: true,
		});
		expect(desktop.opened).toEqual([
			{ name: "fs", command: "npx", args: ["fs-mcp"], env: {} },
		]);
		expect(docker.ensured).toEqual([]);
		expect(handle).not.toHaveProperty("url");
		expect(handle && "transport" in handle && handle.transport()).toBe(channel);
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
		const docker = fallback();
		const host = new BridgedHost(desktop, docker);
		await host.ensure({ name: "plain", command: "npx" });
		await host.ensure({ name: "remote", url: "https://example.test/mcp" });
		expect(docker.ensured).toEqual(["plain", "remote"]);
		expect(desktop.opened).toEqual([]);
	});

	it("closes a bridged server on the desktop and stops the rest on the fallback", async () => {
		const desktop = bridge();
		const docker = fallback();
		const host = new BridgedHost(desktop, docker);
		await host.ensure({ name: "fs", command: "npx", local: true });
		await host.stop("fs");
		await host.stop("other");
		expect(desktop.closed).toEqual(["fs"]);
		expect(docker.stopped).toEqual(["other"]);
		expect(host.status("fs")).toBe("unknown");
	});

	it("passes the bridge's refusal through when no desktop is connected", async () => {
		const host = new BridgedHost(
			{
				open: async () => {
					throw new Error("no desktop connected for this user");
				},
				close: async () => {},
				running: () => true,
				settings: async () => undefined,
			},
			fallback(),
		);
		await expect(
			host.ensure({ name: "fs", command: "npx", local: true }),
		).rejects.toThrow("no desktop connected for this user");
	});
});
