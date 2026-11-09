import { once } from "node:events";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { HttpConnConfig, ServerReport } from "../src/ports.ts";
import { RemoteHost } from "../src/remote-host.ts";

describe("what the remote host reports about the servers it dials", () => {
	let server: Server;
	let answering: HttpConnConfig;

	beforeAll(async () => {
		server = createServer((_, res) => res.end()).listen(0, "127.0.0.1");
		await once(server, "listening");
		const { port } = server.address() as AddressInfo;
		answering = { name: "linear", url: `http://127.0.0.1:${port}/mcp` };
	});

	afterAll(() => {
		server.close();
	});

	function reporting() {
		const reports: ServerReport[] = [];
		return { host: new RemoteHost((r) => reports.push(r)), reports };
	}

	it("reports a server ready once its address answers, and gone once unloaded", async () => {
		const { host, reports } = reporting();

		expect(await host.ensure(answering)).toEqual({ url: answering.url });
		await host.stop("linear");

		expect(reports).toEqual([
			{ server: "linear", phase: "ready" },
			{ server: "linear", phase: "gone" },
		]);
	});

	it("reports a server failed when its address does not answer", async () => {
		const { host, reports } = reporting();

		await host.ensure({ name: "down", url: "http://127.0.0.1:9/mcp" });

		expect(reports).toEqual([
			{
				server: "down",
				phase: "failed",
				reason: "http://127.0.0.1:9 did not answer.",
			},
		]);
	});

	it("reports nothing for a server it never dialed", async () => {
		const { host, reports } = reporting();

		await host.stop("linear");

		expect(reports).toEqual([]);
	});
});
