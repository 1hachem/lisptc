import { existsSync } from "node:fs";
import { join } from "node:path";
import { Interp, runSync } from "@repo/interpreter/lisp";
import { prelude } from "@repo/interpreter/prelude";
import { describe, expect, it } from "vitest";
import { mcpExtension } from "../src/mcp.ts";
import { mcpHost } from "../src/mcp-host.ts";
import type { ConnConfig, McpClient } from "../src/ports.ts";
import { bundledToolkit } from "../src/toolkit.ts";

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

function configFor(name: string, executable = "", flags = ""): ConnConfig {
	const { client, seen } = recording();
	const interp = new Interp({
		extensions: [
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
	runSync(interp, `(load-mcp "${name}"${flags})`);
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
					"--no-sandbox",
					"--isolated",
				],
			},
		);
	});

	it("runs Playwright's own command without its image under :local", () => {
		const conf = configFor("playwright", "/nix/chrome", " :local t");
		expect(conf).not.toHaveProperty("image");
		expect(conf).toMatchObject({ command: "npx" });
	});

	it("appends the headless flag under :headless", () => {
		const conf = configFor("playwright", "/nix/chrome", " :local t :headless");
		expect(conf.args?.at(-1)).toBe("--headless");
	});

	it("refuses :headless for a server without a headless mode", () => {
		expect(() => configFor("ocr", "", " :headless t")).toThrow(/headless/);
	});
});
