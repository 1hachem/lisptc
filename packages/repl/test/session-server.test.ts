import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pidAlive, serve, watchOwner } from "../src/session-server.ts";

function tempSocketPath(): string {
	return join(tmpdir(), `lisptc-test-${randomBytes(4).toString("hex")}.sock`);
}

describe("pidAlive", () => {
	it("is true for the current process", () => {
		expect(pidAlive(process.pid)).toBe(true);
	});

	it("is false for a pid that doesn't exist", () => {
		expect(pidAlive(999999999)).toBe(false);
	});
});

describe("watchOwner", () => {
	it("leaves the server and socket alone while the owner is alive", async () => {
		const path = tempSocketPath();
		const server = await serve(path);
		const exit = () => {
			throw new Error("should not exit while the owner is alive");
		};

		watchOwner(process.pid, path, server, { intervalMs: 10, exit });
		await new Promise((r) => setTimeout(r, 50));

		expect(existsSync(path)).toBe(true);
		server.close();
	});

	it("closes the server and deletes the socket once the owner pid is gone", async () => {
		const path = tempSocketPath();
		const server = await serve(path);
		let exitCode: number | undefined;

		// A pid guaranteed to be dead by the first poll tick.
		watchOwner(999999999, path, server, {
			intervalMs: 10,
			exit: (code) => {
				exitCode = code;
			},
		});
		await new Promise((r) => setTimeout(r, 50));

		expect(exitCode).toBe(0);
		expect(existsSync(path)).toBe(false);
	});
});
