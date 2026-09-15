import { existsSync } from "node:fs";
import { join } from "node:path";
import { Interp, prelude, runSync } from "@repo/interpreter/lisp";
import { promisesExtension } from "@repo/interpreter/promises";
import { describe, expect, it } from "vitest";
import { mcpExtension } from "../src/mcp.ts";
import { mcpHost } from "../src/mcp-host.ts";
import type { ConnConfig, McpClient } from "../src/ports.ts";

function recording(): { client: McpClient; seen: ConnConfig[] } {
	const seen: ConnConfig[] = [];
	const never = <T>(): Promise<T> => new Promise(() => {});
	return {
		seen,
		client: {
			connect: (conf) => {
				seen.push(conf);
				return never();
			},
			callTool: () => never(),
			disconnect: () => Promise.resolve(),
			login: () => Promise.resolve({ authUrl: null }),
			logout: () => Promise.resolve(),
			authorize: () => Promise.resolve(),
			shutdown: () => Promise.resolve(),
		},
	};
}

function argsFor(name: string): string[] {
	const { client, seen } = recording();
	const interp = new Interp({
		extensions: [promisesExtension(), mcpExtension({ ...mcpHost, client })],
	});
	runSync(interp, prelude);
	runSync(interp, `(load-mcp "${name}")`);
	const conf = seen[0];
	if (!conf || !("args" in conf) || !conf.args)
		throw new Error(`no stdio args recorded for "${name}"`);
	return conf.args;
}

describe("bundled toolkit commands resolve against the manifest", () => {
	for (const name of ["sheets", "ocr"]) {
		it(`points ${name} at the directory holding Taskfile.yml`, () => {
			const dir = argsFor(name)[1];
			expect(dir).toBeDefined();
			expect(existsSync(join(dir as string, "Taskfile.yml"))).toBe(true);
		});
	}
});
