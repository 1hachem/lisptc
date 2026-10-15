import { existsSync } from "node:fs";
import { join } from "node:path";
import { Interp, runSync } from "@repo/interpreter/lisp";
import { prelude } from "@repo/interpreter/prelude";
import { describe, expect, it } from "vitest";
import { mcpExtension } from "../src/mcp.ts";
import { mcpHost } from "../src/mcp-host.ts";
import type { ConnConfig, McpClient } from "../src/ports.ts";
import { bundledToolkit, localToolkit } from "../src/toolkit.ts";

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
			asleep: () => Promise.resolve(false),
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
			mcpExtension({
				...mcpHost,
				client,
				toolkit: localToolkit({
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

describe("local toolkit commands resolve against the manifest", () => {
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

	it("runs Playwright from its local command", () => {
		expect(configFor("playwright", "/nix/store/chromium/chrome")).toEqual({
			name: "playwright",
			description: expect.any(String),
			keywords: expect.any(Array),
			command: "npx",
			args: [
				"-y",
				"@playwright/mcp@0.0.81",
				"--browser",
				"chromium",
				"--executable-path",
				"/nix/store/chromium/chrome",
				"--no-sandbox",
			],
		});
	});
});

describe("the local toolkit runs no container", () => {
	for (const conf of localToolkit().all()) {
		it(`names no image for ${conf.name}`, () => {
			expect("image" in conf).toBe(false);
		});
	}
});

const DOCKERFILES = new URL("../../../docker/mcp/", import.meta.url);

describe("the production toolkit runs nothing on the machine it is read on", () => {
	for (const conf of bundledToolkit().all()) {
		it(`serves ${conf.name} from its own image or a remote url`, () => {
			expect("command" in conf).toBe(false);
			const built = existsSync(new URL(`${conf.name}.Dockerfile`, DOCKERFILES));
			if ("image" in conf) {
				expect(Boolean(conf.internal)).toBe(built);
				if (built)
					expect(conf.image).toBe(
						`ghcr.io/1hachem/lisptc-mcp-${conf.name}:main`,
					);
			} else {
				expect("url" in conf && conf.url).toMatch(/^https:\/\//);
			}
		});
	}
});
