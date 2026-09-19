import { describe, expect, it } from "vitest";
import { DockerHost, launchFor } from "../src/docker-host.ts";
import type { HttpConnConfig } from "../src/ports.ts";
import { recordingHost } from "./helpers.ts";

const locallyLaunched: HttpConnConfig = {
	name: "sheets",
	url: "http://localhost:8911/mcp",
	command: "task",
	args: ["--dir", "../..", "mcp:sheets"],
};

const remote: HttpConnConfig = {
	name: "linear",
	url: "https://mcp.linear.app/mcp",
	oauth: true,
};

describe("what the docker host does with each toolkit modality", () => {
	it("runs an image-backed server from its own image", () => {
		const launch = launchFor({
			name: "playwright",
			image: "lisptc/browser-mcp:v1.63.0",
			port: 8931,
		});

		expect(launch).toEqual({
			image: "lisptc/browser-mcp:v1.63.0",
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

describe("the docker host", () => {
	it("hands a server it launches no container for to the fallback", async () => {
		const fallback = recordingHost();
		const host = new DockerHost(fallback);

		const handle = await host.ensure(locallyLaunched);

		expect(handle).toEqual({ url: "http://localhost:8911/mcp" });
		expect(fallback.ensured.map((c) => c.name)).toEqual(["sheets"]);
	});

	it("asks the fallback about a server it never started", async () => {
		const host = new DockerHost(recordingHost());

		expect(host.status("known")).toBe("running");
		expect(host.logs("known")).toBe("the fallback's log");
		expect(host.status("playwright")).toBe("unknown");
	});

	it("stops through the fallback for a name it does not own", async () => {
		const fallback = recordingHost();
		const host = new DockerHost(fallback);

		await host.stop("sheets");

		expect(fallback.stopped).toEqual(["sheets"]);
	});

	it("takes the fallback down with it", async () => {
		const fallback = recordingHost();
		const host = new DockerHost(fallback);

		await host.stopAll();

		expect(fallback.stoppedAll).toBe(1);
	});
});
