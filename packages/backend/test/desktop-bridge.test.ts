import type {
	ConnConfig,
	McpHost,
	ServerState,
} from "@repo/mcp-extension/ports";
import { describe, expect, it } from "vitest";
import type { Id } from "../convex/_generated/dataModel.js";
import {
	BridgedHost,
	type DesktopBridge,
	type LocalServer,
} from "../src/desktop-bridge.ts";

const owner = "user-1" as Id<"users">;

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

function bridge(): DesktopBridge & {
	opened: [Id<"users">, LocalServer][];
	closed: string[];
} {
	const opened: [Id<"users">, LocalServer][] = [];
	const closed: string[] = [];
	return {
		opened,
		closed,
		connected: () => true,
		open: async (userId, server) => {
			opened.push([userId, server]);
			return async () => new Response("bridged");
		},
		close: async (_userId, name) => {
			closed.push(name);
		},
	};
}

describe("BridgedHost", () => {
	it("opens a :local command server on the owner's desktop", async () => {
		const desktop = bridge();
		const docker = fallback();
		const host = new BridgedHost(owner, desktop, docker);
		const handle = await host.ensure({
			name: "fs",
			command: "npx",
			args: ["fs-mcp"],
			local: true,
		});
		expect(desktop.opened).toEqual([
			[owner, { name: "fs", command: "npx", args: ["fs-mcp"], env: {} }],
		]);
		expect(docker.ensured).toEqual([]);
		expect(handle?.url).toBe("http://desktop.bridge/fs/mcp");
		expect(await (await handle?.fetch?.(handle.url))?.text()).toBe("bridged");
		expect(host.status("fs")).toBe("running");
	});

	it("leaves every other server to the fallback host", async () => {
		const desktop = bridge();
		const docker = fallback();
		const host = new BridgedHost(owner, desktop, docker);
		await host.ensure({ name: "plain", command: "npx" });
		await host.ensure({ name: "remote", url: "https://example.test/mcp" });
		expect(docker.ensured).toEqual(["plain", "remote"]);
		expect(desktop.opened).toEqual([]);
	});

	it("closes a bridged server on the desktop and stops the rest on the fallback", async () => {
		const desktop = bridge();
		const docker = fallback();
		const host = new BridgedHost(owner, desktop, docker);
		await host.ensure({ name: "fs", command: "npx", local: true });
		await host.stop("fs");
		await host.stop("other");
		expect(desktop.closed).toEqual(["fs"]);
		expect(docker.stopped).toEqual(["other"]);
		expect(host.status("fs")).toBe("unknown");
	});

	it("passes the bridge's refusal through when no desktop is connected", async () => {
		const host = new BridgedHost(
			owner,
			{
				connected: () => false,
				open: async () => {
					throw new Error("no desktop connected for this user");
				},
				close: async () => {},
			},
			fallback(),
		);
		await expect(
			host.ensure({ name: "fs", command: "npx", local: true }),
		).rejects.toThrow("no desktop connected for this user");
	});
});
