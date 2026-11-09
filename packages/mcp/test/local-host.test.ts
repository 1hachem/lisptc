import { once } from "node:events";
import { createServer } from "node:net";
import { describe, expect, it, vi } from "vitest";
import { LocalProcessHost } from "../src/local-host.ts";
import type { HttpConnConfig, ServerReport } from "../src/ports.ts";

async function freePort(): Promise<number> {
	const probe = createServer().listen(0, "127.0.0.1");
	await once(probe, "listening");
	const address = probe.address();
	probe.close();
	if (address === null || typeof address === "string")
		throw new Error("no port was bound");
	return address.port;
}

function serving(port: number, script: string): HttpConnConfig {
	return {
		name: "notes",
		url: `http://127.0.0.1:${port}/mcp`,
		command: process.execPath,
		args: ["-e", script],
	};
}

function answering(port: number, exitAfterMs?: number): string {
	return [
		`require("node:http").createServer((_, res) => res.end()).listen(${port}, "127.0.0.1");`,
		exitAfterMs === undefined
			? ""
			: `setTimeout(() => { console.error("out of memory"); process.exit(3); }, ${exitAfterMs});`,
	].join("\n");
}

function reporting() {
	const reports: ServerReport[] = [];
	const host = new LocalProcessHost((r) => reports.push(r));
	return { host, reports };
}

describe("what the local process host reports about the servers it runs", () => {
	it("reports a server starting, then ready, then asleep once stopped", async () => {
		const { host, reports } = reporting();
		const port = await freePort();
		const conf = serving(port, answering(port));

		await host.ensure(conf);
		await host.ensure(conf);
		await host.stop("notes");

		expect(reports).toEqual([
			{ server: "notes", phase: "starting" },
			{ server: "notes", phase: "ready" },
			{ server: "notes", phase: "sleeping" },
		]);
	});

	it("reports a removed server gone, so its row goes", async () => {
		const { host, reports } = reporting();
		const port = await freePort();
		const conf = serving(port, answering(port));

		await host.ensure(conf);
		await host.remove(conf);

		expect(reports.at(-1)).toEqual({ server: "notes", phase: "gone" });
		expect(host.status("notes")).toBe("unknown");
	});

	it("reports a server failed when it exits before it answers", async () => {
		const { host, reports } = reporting();
		const conf = serving(
			await freePort(),
			`console.error("bad config"); process.exit(2);`,
		);

		await expect(host.ensure(conf)).rejects.toThrow(/exited with code 2/);

		expect(reports.map((r) => r.phase)).toEqual(["starting", "failed"]);
		expect(reports[1]?.reason).toMatch(/bad config/);
	});

	it("reports a server failed when it exits on its own", async () => {
		const { host, reports } = reporting();
		const port = await freePort();

		await host.ensure(serving(port, answering(port, 500)));

		await vi.waitFor(() => expect(reports).toHaveLength(3), { timeout: 5000 });
		expect(reports[2]).toEqual({
			server: "notes",
			phase: "failed",
			reason: "its process exited with code 3.\nout of memory",
		});
		expect(host.status("notes")).toBe("unknown");
	});

	it("watches the servers it launches, and leaves a remote one to the session", () => {
		const host = new LocalProcessHost();

		expect(host.watches(serving(8000, ""))).toBe(true);
		expect(
			host.watches({ name: "linear", url: "https://mcp.linear.app/mcp" }),
		).toBe(false);
	});
});
