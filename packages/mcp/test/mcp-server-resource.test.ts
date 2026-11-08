import { describe, expect, it } from "vitest";
import { launchFor } from "../src/docker-host.ts";
import {
	NAME_MAX,
	serverName,
	specFor,
	workloadHash,
} from "../src/mcp-server-resource.ts";
import type { ContainerConnConfig, StdioConnConfig } from "../src/ports.ts";

const browser: ContainerConnConfig = {
	name: "playwright",
	image: "playwright-mcp",
	port: 8931,
	args: ["--cdp-endpoint", "http://localhost:9222"],
	app: {
		image: "chromium-vnc",
		ports: [
			{ name: "cdp", port: 9222 },
			{ name: "view", port: 6080 },
		],
		expose: ["view"],
	},
};

function spec(conf: ContainerConnConfig | StdioConnConfig) {
	const launch = launchFor(conf);
	if (!launch) throw new Error("no launch");
	return specFor(conf, launch, "ws1", 1000);
}

describe("the spec a server is created from", () => {
	it("pairs the mcp with the app it drives", () => {
		const made = spec(browser);

		expect(made.mcp).toMatchObject({
			image: "playwright-mcp",
			port: 8931,
			path: "/mcp",
		});
		expect(made.app).toMatchObject({
			image: "chromium-vnc",
			expose: ["view"],
		});
		expect(made).toMatchObject({
			workspace: "ws1",
			server: "playwright",
			restarts: 0,
			lastUsed: 1000,
		});
	});

	it("leaves the app out of a server that has none", () => {
		expect(
			spec({ name: "fs", command: "npx", args: ["server"] }),
		).not.toHaveProperty("app");
	});

	it("refuses an exposed port the app does not declare", () => {
		expect(() =>
			spec({ ...browser, app: { image: "x", expose: ["view"] } }),
		).toThrow(/no port by that name/);
	});
});

describe("naming in the cluster", () => {
	it("names a server the same way every time, within a dns label", () => {
		const long = "a".repeat(80);
		expect(serverName("ws1", "playwright")).toBe(
			serverName("ws1", "playwright"),
		);
		expect(serverName(long, long).length).toBeLessThanOrEqual(NAME_MAX);
	});

	it("keeps two servers apart even when truncation would join them", () => {
		const prefix = "s".repeat(40);
		expect(serverName("ws1", `${prefix}-one`)).not.toBe(
			serverName("ws1", `${prefix}-two`),
		);
	});

	it("gives each instance of a server its own name", () => {
		expect(serverName("ws1", "playwright", "chat-a")).not.toBe(
			serverName("ws1", "playwright"),
		);
		expect(serverName("ws1", "playwright", "chat-a")).not.toBe(
			serverName("ws1", "playwright", "chat-b"),
		);
	});
});

describe("what rolls the pod", () => {
	it("ignores a heartbeat", () => {
		const made = spec(browser);
		expect(workloadHash({ ...made, lastUsed: 9999 })).toBe(workloadHash(made));
	});

	it("follows a restart and a new image", () => {
		const made = spec(browser);
		expect(workloadHash({ ...made, restarts: 1 })).not.toBe(workloadHash(made));
		expect(
			workloadHash({
				...made,
				mcp: { ...made.mcp, image: "playwright-mcp:2" },
			}),
		).not.toBe(workloadHash(made));
	});
});
