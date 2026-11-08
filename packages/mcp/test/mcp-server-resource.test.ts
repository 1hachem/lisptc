import { describe, expect, it } from "vitest";
import { launchFor } from "../src/docker-host.ts";
import {
	claimName,
	DEFAULT_RETENTION_SECONDS,
	NAME_MAX,
	serverName,
	specFor,
	stateEntries,
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
		state: "/data/profile",
	},
};

function spec(conf: ContainerConnConfig | StdioConnConfig) {
	const launch = launchFor(conf);
	if (!launch) throw new Error("no launch");
	return specFor(conf, launch, "ws1", 1000);
}

describe("the state a container keeps", () => {
	it("reads a bare path as a 1Gi claim named after its last segment", () => {
		expect(stateEntries("/data/profile")).toEqual([
			{
				name: "profile",
				path: "/data/profile",
				size: "1Gi",
				reclaim: "Retain",
				retentionSeconds: DEFAULT_RETENTION_SECONDS,
				reset: 0,
			},
		]);
	});

	it("takes a name, size and reclaim policy from the object form", () => {
		expect(
			stateEntries([
				"/var/lib/odoo",
				{ name: "db", path: "/pg", size: "5Gi", reclaim: "Delete" },
			]).map(({ name, size, reclaim }) => ({ name, size, reclaim })),
		).toEqual([
			{ name: "odoo", size: "1Gi", reclaim: "Retain" },
			{ name: "db", size: "5Gi", reclaim: "Delete" },
		]);
	});

	it("refuses a path that is not absolute", () => {
		expect(() => stateEntries("data/profile")).toThrow(/not absolute/);
	});

	it("refuses the root, which names no volume", () => {
		expect(() => stateEntries("/")).toThrow(/names no volume/);
	});
});

describe("the spec a server is created from", () => {
	it("pairs the mcp with the app it drives, keeping state on the app", () => {
		const made = spec(browser);

		expect(made.mcp).toMatchObject({
			image: "playwright-mcp",
			port: 8931,
			path: "/mcp",
			state: [],
		});
		expect(made.app).toMatchObject({
			image: "chromium-vnc",
			expose: ["view"],
			state: [{ name: "profile", path: "/data/profile" }],
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

	it("refuses two state entries with one name across the pair", () => {
		expect(() =>
			spec({ ...browser, state: { name: "profile", path: "/out" } }),
		).toThrow(/both named "profile"/);
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
		expect(claimName("srv", "profile")).not.toBe(claimName("srv", "cache"));
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
	it("ignores a heartbeat, a resize and a reset", () => {
		const made = spec(browser);
		const app = made.app;
		if (!app) throw new Error("no app");
		const touched = {
			...made,
			lastUsed: 9999,
			app: {
				...app,
				state: app.state.map((s) => ({ ...s, size: "5Gi", reset: 3 })),
			},
		};
		expect(workloadHash(touched)).toBe(workloadHash(made));
	});

	it("follows a restart and a new mount", () => {
		const made = spec(browser);
		expect(workloadHash({ ...made, restarts: 1 })).not.toBe(workloadHash(made));
		expect(workloadHash(spec({ ...browser, state: "/tmp/output" }))).not.toBe(
			workloadHash(made),
		);
	});
});
