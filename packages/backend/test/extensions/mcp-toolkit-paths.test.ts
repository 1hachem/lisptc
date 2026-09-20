import { existsSync } from "node:fs";
import { join } from "node:path";
import { Interp, prelude, runSync } from "@repo/interpreter/lisp";
import { mcpExtension } from "@repo/mcp-extension";
import { mcpHost } from "@repo/mcp-extension/mcp-host";
import type { ConnConfig, McpClient } from "@repo/mcp-extension/ports";
import { bundledToolkit } from "@repo/mcp-extension/toolkit";
import { promisesExtension } from "@repo/promises-extension";
import { describe, expect, it } from "vitest";

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

function configFor(name: string, executable = ""): ConnConfig {
	const { client, seen } = recording();
	const interp = new Interp({
		extensions: [
			promisesExtension(),
			mcpExtension({
				...mcpHost,
				client,
				toolkit: bundledToolkit({
					get: (key) =>
						key === "PLAYWRIGHT_MCP_EXECUTABLE" ? executable : undefined,
				}),
			}),
		],
	});
	runSync(interp, prelude);
	runSync(interp, `(load-mcp "${name}")`);
	const conf = seen[0];
	if (!conf) throw new Error(`no config recorded for "${name}"`);
	return conf;
}

describe("bundled toolkit commands resolve against the manifest", () => {
	for (const name of ["sheets", "ocr"]) {
		it(`points ${name} at the directory holding Taskfile.yml`, () => {
			const conf = configFor(name);
			if (!("args" in conf) || !conf.args)
				throw new Error(`no stdio args recorded for "${name}"`);
			const dir = conf.args[1];
			expect(dir).toBeDefined();
			expect(existsSync(join(dir as string, "Taskfile.yml"))).toBe(true);
		});
	}

	it("keeps Playwright's local command alongside its container image", () => {
		expect(configFor("playwright", "/nix/store/chromium/chrome")).toMatchObject(
			{
				image: "lisptc/browser-mcp:v1.63.0",
				port: 8931,
				command: "npx",
				args: [
					"-y",
					"@playwright/mcp@0.0.81",
					"--browser",
					"chromium",
					"--executable-path",
					"/nix/store/chromium/chrome",
					"--headless",
					"--no-sandbox",
					"--isolated",
				],
			},
		);
	});
});
