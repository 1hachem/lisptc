import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	connectOrSpawn,
	PROTOCOL_VERSION,
	SessionClient,
	serve,
} from "../src/session-server.ts";

function tempPath(): string {
	return join(tmpdir(), `lisptc-test-${randomUUID()}.sock`);
}

function fakeServer(
	path: string,
	ops: Partial<Record<string, (req: { id: number }) => unknown>>,
): Promise<Server> {
	return new Promise((resolve, reject) => {
		const server = createServer((socket) => {
			let buffer = "";
			socket.on("data", (chunk) => {
				buffer += chunk.toString("utf8");
				let nl = buffer.indexOf("\n");
				while (nl !== -1) {
					const line = buffer.slice(0, nl);
					buffer = buffer.slice(nl + 1);
					if (line.trim() !== "") {
						const req = JSON.parse(line) as { id: number; op: string };
						const handler = ops[req.op];
						const reply = handler
							? { id: req.id, ok: true, result: handler(req) }
							: { id: req.id, ok: false, error: `unknown op: ${req.op}` };
						socket.write(`${JSON.stringify(reply)}\n`, () => {
							if (req.op === "shutdown" && handler) server.close();
						});
					}
					nl = buffer.indexOf("\n");
				}
			});
		});
		server.once("error", reject);
		server.listen(path, () => resolve(server));
	});
}

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function killClient(client: SessionClient): Promise<void> {
	try {
		await client.shutdown();
	} catch {
	} finally {
		client.destroy();
	}
}

describe("serve", () => {
	it("answers a version request with the current protocol version", async () => {
		const path = tempPath();
		const server = await serve(path);
		cleanups.push(() => {
			server.close();
		});
		const client = await SessionClient.connect(path);
		cleanups.push(() => client.destroy());
		expect(await client.version()).toBe(PROTOCOL_VERSION);
	});
});

describe("connectOrSpawn", () => {
	it("returns a client straight through when the server already speaks the current protocol", async () => {
		const path = tempPath();
		const server = await serve(path);
		cleanups.push(() => {
			server.close();
		});
		const client = await connectOrSpawn(path);
		cleanups.push(() => client.destroy());
		expect(await client.version()).toBe(PROTOCOL_VERSION);
	});

	it("replaces a stale server that supports shutdown but predates the version op", async () => {
		const path = tempPath();
		let shutdownCalls = 0;
		const stale = await fakeServer(path, {
			shutdown: () => {
				shutdownCalls++;
				return "";
			},
			eval: () => "stale-eval-result\n",
		});
		cleanups.push(() => {
			stale.close();
		});

		const client = await connectOrSpawn(path);
		cleanups.push(() => killClient(client));

		expect(shutdownCalls).toBe(1);
		expect(await client.version()).toBe(PROTOCOL_VERSION);
	}, 30_000);

	it("falls back to the stale server when it can't be shut down (predates shutdown too)", async () => {
		const path = tempPath();
		const ancient = await fakeServer(path, {
			eval: () => "ancient-eval-result\n",
		});
		cleanups.push(() => {
			ancient.close();
		});

		const client = await connectOrSpawn(path);
		cleanups.push(() => client.destroy());

		await expect(client.version()).rejects.toThrow(/unknown op/);
		expect(await client.eval("anything")).toBe("ancient-eval-result\n");
	});
});
