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
		await host.stop({ name: "notes" });

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
		expect(host.status({ name: "notes" })).toBe("unknown");
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
		expect(host.status({ name: "notes" })).toBe("unknown");
	});
});

describe("what the local process host reports about the stdio servers it pipes", () => {
	async function piped(
		host: LocalProcessHost,
		script: string,
		instance?: string,
	) {
		const command = { command: process.execPath, args: ["-e", script] };
		const handle = await host.ensure(
			instance === undefined
				? { name: "fx", ...command }
				: { name: "fx", image: "fx-mcp", port: 8000, instance, ...command },
		);
		if (!("transport" in handle)) throw new Error("expected a transport");
		const transport = handle.transport();
		await transport.start();
		return transport;
	}

	it("reports a server starting, then ready, then asleep once its connection closes", async () => {
		const { host, reports } = reporting();
		const transport = await piped(host, "setInterval(() => {}, 1000)");

		await transport.close();

		await vi.waitFor(() => expect(reports).toHaveLength(3), { timeout: 5000 });
		expect(reports).toEqual([
			{ server: "fx", phase: "starting" },
			{ server: "fx", phase: "ready" },
			{ server: "fx", phase: "sleeping" },
		]);
		expect(host.status({ name: "fx" })).toBe("unknown");
	});

	it("reports a chat's own server under its instance, apart from the shared one", async () => {
		const { host, reports } = reporting();
		const transport = await piped(host, "setInterval(() => {}, 1000)", "c1");

		expect(reports).toEqual([
			{ server: "fx", instance: "c1", phase: "starting" },
			{ server: "fx", instance: "c1", phase: "ready" },
		]);
		expect(host.status({ name: "fx", instance: "c1" })).toBe("running");
		expect(host.status({ name: "fx" })).toBe("unknown");
		await transport.close();
	});

	it("reports a server failed when it exits on its own", async () => {
		const { host, reports } = reporting();
		await piped(host, "setTimeout(() => process.exit(1), 200)");

		await vi.waitFor(() => expect(reports).toHaveLength(3), { timeout: 5000 });
		expect(reports[2]).toMatchObject({ server: "fx", phase: "failed" });
		expect(host.status({ name: "fx" })).toBe("unknown");
	});

	it("refuses an image it has no command to run", async () => {
		const { host } = reporting();

		await expect(
			host.ensure({ name: "fs", image: "fs-mcp", port: 8000 }),
		).rejects.toThrow(/runs as a container image/);
	});
});
