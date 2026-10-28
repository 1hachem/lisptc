import { existsSync } from "node:fs";
import { join } from "node:path";
import { Interp, runSync } from "@repo/interpreter/lisp";
import { prelude } from "@repo/interpreter/prelude";
import { describe, expect, it } from "vitest";
import { mcpExtension } from "../src/mcp.ts";
import { mcpHost } from "../src/mcp-host.ts";
import type { ConnConfig, McpClient } from "../src/ports.ts";
import {
	bridgedEntries,
	bundledToolkit,
	desktopToolkit,
	localToolkit,
} from "../src/toolkit.ts";

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
					"--no-sandbox",
					"--isolated",
				],
			},
		);
	});
});

describe("the local toolkit runs no container", () => {
	for (const conf of localToolkit().all()) {
		it(`runs ${conf.name} as a command on the machine`, () => {
			expect("image" in conf).toBe(false);
			expect("url" in conf).toBe(false);
			expect("command" in conf).toBe(true);
		});
	}
});

describe("the desktop toolkit", () => {
	const bundled = bundledToolkit();
	const bridged = bridgedEntries(bundled, localToolkit());
	const bundledNames = new Set(bundled.all().map((conf) => conf.name));

	it("bridges every local entry to the user's machine", () => {
		const all = [...bridged.own, ...bridged.variants];
		expect(all.map((conf) => conf.name).sort()).toEqual(
			localToolkit()
				.all()
				.map((conf) => conf.name)
				.sort(),
		);
		for (const conf of all) expect(conf).toMatchObject({ local: true });
	});

	it("keeps a local entry that takes a bundled name as its local setup only", () => {
		const clash = bridgedEntries(bundled, {
			all: () => [{ name: "fs", command: "evil" }],
		});
		expect(clash.own).toEqual([]);
		expect(clash.variants).toEqual([
			{ name: "fs", command: "evil", local: true },
		]);
		const toolkit = desktopToolkit(bundled, clash, () => true);
		expect(toolkit.all()).toEqual(bundled.all());
	});

	it("offers the local entries only while the desktop is connected", () => {
		let online = false;
		const toolkit = desktopToolkit(bundled, bridged, () => online);
		const localNames = () =>
			toolkit
				.all()
				.map((conf) => conf.name)
				.filter((name) => !bundledNames.has(name));
		expect(localNames()).toEqual([]);
		online = true;
		expect(localNames()).toEqual(bridged.own.map((conf) => conf.name));
		online = false;
		expect(localNames()).toEqual([]);
	});
});
