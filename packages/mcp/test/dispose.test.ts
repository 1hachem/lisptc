import { Interp, prelude, runSync } from "@repo/interpreter/lisp";
import { promisesExtension } from "@repo/promises-extension";
import { describe, expect, it } from "vitest";
import { mcpExtension } from "../src/mcp.ts";
import { mcpHost } from "../src/mcp-host.ts";
import type { McpClient } from "../src/ports.ts";

function hangingClient(): { client: McpClient; aborts: () => number } {
	let aborts = 0;
	const hang = <T>(signal?: AbortSignal): Promise<T> =>
		new Promise(() => {
			signal?.addEventListener("abort", () => {
				aborts++;
			});
		});
	return {
		client: {
			connect: (_conf, signal) => hang(signal),
			callTool: (_call, signal) => hang(signal),
			disconnect: () => Promise.resolve(),
			login: () => Promise.resolve({ authUrl: null }),
			logout: () => Promise.resolve(),
			authorize: () => Promise.resolve(),
			shutdown: () => Promise.resolve(),
		},
		aborts: () => aborts,
	};
}

function loading(client: McpClient): Interp {
	const interp = new Interp({
		extensions: [promisesExtension(), mcpExtension({ ...mcpHost, client })],
	});
	runSync(interp, prelude);
	runSync(interp, '(load-mcp :name "x" :command "node")');
	return interp;
}

describe("Interp.dispose", () => {
	it("aborts work still in flight when the host drops the interp", () => {
		const { client, aborts } = hangingClient();
		const interp = loading(client);
		expect(aborts()).toBe(0);
		interp.dispose();
		expect(aborts()).toBe(1);
	});

	it("is idempotent, and composes with the agent's own (mcp-shutdown)", () => {
		const { client, aborts } = hangingClient();
		const interp = loading(client);
		interp.dispose();
		interp.dispose();
		expect(aborts()).toBe(1);
	});

	it("does nothing on an interp with no extensions", () => {
		expect(() => new Interp().dispose()).not.toThrow();
	});
});

describe("starting a promise does not suspend", () => {
	it("lets a synchronous host begin background work", () => {
		const { client } = hangingClient();
		const interp = new Interp({
			extensions: [promisesExtension(), mcpExtension({ ...mcpHost, client })],
		});
		runSync(interp, prelude);
		expect(
			runSync(interp, '(promise-state (load-mcp :name "x" :command "node"))'),
		).toEqual(expect.objectContaining({ name: "pending" }));
	});
});
