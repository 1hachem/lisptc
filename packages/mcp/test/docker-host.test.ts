import { once } from "node:events";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { DockerHost, launchFor } from "../src/docker-host.ts";
import type { ConnConfig, HttpConnConfig, ServerReport } from "../src/ports.ts";
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

const stubDocker = `#!/bin/sh
case "$1" in
  run) [ -n "$STUB_DOCKER_REFUSE" ] && { echo "no such image" >&2; exit 1; }; echo stub-container ;;
  port) echo "$STUB_DOCKER_ADDRESS" ;;
  logs) echo "server listening"; exec sleep "$STUB_DOCKER_LIVES" ;;
esac
`;

const playwright: ConnConfig = {
	name: "playwright",
	image: "ghcr.io/1hachem/lisptc-mcp-playwright:main",
	port: 8931,
};

describe("what the docker host reports about the containers it runs", () => {
	const saved = { ...process.env };
	let server: Server;

	beforeAll(async () => {
		const bin = mkdtempSync(join(tmpdir(), "stub-docker-"));
		writeFileSync(join(bin, "docker"), stubDocker, { mode: 0o755 });
		server = createServer((_, res) => res.end()).listen(0, "127.0.0.1");
		await once(server, "listening");
		const { port } = server.address() as AddressInfo;
		process.env.PATH = `${bin}${delimiter}${process.env.PATH}`;
		process.env.STUB_DOCKER_ADDRESS = `127.0.0.1:${port}`;
	});

	afterEach(() => {
		delete process.env.STUB_DOCKER_REFUSE;
	});

	afterAll(() => {
		process.env = saved;
		server.close();
	});

	function reporting(lives: number) {
		process.env.STUB_DOCKER_LIVES = String(lives);
		const reports: ServerReport[] = [];
		const host = new DockerHost(recordingHost(), "ws", (r) => reports.push(r));
		return { host, reports };
	}

	it("reports a server starting, then ready, then asleep once stopped", async () => {
		const { host, reports } = reporting(30);

		await host.ensure(playwright);
		await host.stop("playwright");

		expect(reports).toEqual([
			{ server: "playwright", phase: "starting" },
			{ server: "playwright", phase: "ready" },
			{ server: "playwright", phase: "sleeping" },
		]);
	});

	it("reports a server failed when its container cannot be run", async () => {
		process.env.STUB_DOCKER_REFUSE = "1";
		const { host, reports } = reporting(30);

		await expect(host.ensure(playwright)).rejects.toThrow(/docker run failed/);

		expect(reports.map((r) => r.phase)).toEqual(["starting", "failed"]);
		expect(reports[1]?.reason).toMatch(/no such image/);
	});

	it("reports a server failed when its container exits on its own", async () => {
		const { host, reports } = reporting(1);

		await host.ensure(playwright);

		await vi.waitFor(() => expect(reports).toHaveLength(3), { timeout: 5000 });
		expect(reports[2]).toEqual({
			server: "playwright",
			phase: "failed",
			reason: "its container exited.\nserver listening",
		});
		expect(host.status("playwright")).toBe("unknown");
		expect(await host.phase("playwright")).toEqual({
			phase: "failed",
			reason: "server listening",
		});
	});

	it("answers ready while its container runs, and asleep once stopped", async () => {
		const { host } = reporting(30);

		await host.ensure(playwright);
		expect(await host.phase("playwright")).toEqual({ phase: "ready" });
		await host.stop("playwright");

		expect(await host.phase("playwright")).toEqual({ phase: "sleeping" });
	});

	it("asks the fallback about a server it never ran", async () => {
		const fallback = recordingHost();
		fallback.phases.set("remote", { phase: "gone" });
		const host = new DockerHost(fallback);

		expect(await host.phase("remote")).toEqual({ phase: "gone" });
	});
});
