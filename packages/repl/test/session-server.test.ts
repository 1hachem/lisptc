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

// A minimal hand-rolled server speaking the same newline-delimited JSON
// protocol as the real one, but only the given `ops` -- used to stand in for
// a session server built before a protocol change, without needing an actual
// old build of session-server.ts to run against.
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
							// `close()` unlinks the socket path itself -- doing it by hand
							// here could delete the REPLACEMENT server's socket file, since
							// by then the name may already belong to it.
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
		// best-effort; the client might be talking to a server too old to
		// understand `shutdown` at all (that's the point of some of these tests)
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

	// The generous timeout: this one really spawns a server, i.e. a cold `node
	// --experimental-transform-types` start that type-strips the whole
	// interpreter -- slower than vitest's 5s default on a loaded CI runner.
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
		// The client is now talking to a freshly spawned, current-protocol
		// server -- not the stale one (which only knows `eval`/`shutdown`).
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

		// No current-protocol server could be spawned in its place (the path is
		// still held by the ancient one), so we're still talking to it.
		await expect(client.version()).rejects.toThrow(/unknown op/);
		expect(await client.eval("anything")).toBe("ancient-eval-result\n");
	});
});
