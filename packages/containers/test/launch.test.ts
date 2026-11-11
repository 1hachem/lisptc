import type { LaunchedEntry, RemoteEntry } from "@repo/toolkit";
import { describe, expect, it } from "vitest";
import { launchFor } from "../src/launch.ts";

const locallyLaunched: LaunchedEntry = {
	name: "sheets",
	url: "http://localhost:8911/mcp",
	command: "task",
	args: ["--dir", "../..", "mcp:sheets"],
};

const remote: RemoteEntry = {
	name: "linear",
	url: "https://mcp.linear.app/mcp",
	oauth: true,
};

describe("how each toolkit modality launches in a container", () => {
	it("runs an image-backed server from its own image", () => {
		const launch = launchFor({
			name: "playwright",
			image: "ghcr.io/1hachem/lisptc-mcp-playwright:main",
			port: 8931,
			command: "npx",
			args: ["-y", "@playwright/mcp@0.0.81"],
		});

		expect(launch).toEqual({
			image: "ghcr.io/1hachem/lisptc-mcp-playwright:main",
			exposed: "8931",
			path: "/mcp",
			args: [],
		});
	});

	it("wraps a stdio server in a gateway that speaks streamable http", () => {
		const launch = launchFor({
			name: "fs",
			command: "npx",
			args: ["-y", "@modelcontextprotocol/server-filesystem", "."],
		});

		expect(launch?.image).toMatch(/^supercorp\/supergateway:/);
		expect(launch?.path).toBe("/mcp");
		expect(launch?.args).toEqual([
			"--stdio",
			"npx -y @modelcontextprotocol/server-filesystem .",
			"--outputTransport",
			"streamableHttp",
			"--stateful",
			"--port",
			"8000",
			"--streamableHttpPath",
			"/mcp",
		]);
	});

	it("leaves a server that already speaks http alone", () => {
		expect(launchFor(remote)).toBeUndefined();
		expect(launchFor(locallyLaunched)).toBeUndefined();
	});
});
