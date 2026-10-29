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
	machineToolkit,
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
			asleep: () => Promise.resolve(false),
			login: () => Promise.resolve({ authUrl: null }),
			logout: () => Promise.resolve(),
			authorize: () => Promise.resolve(),
			shutdown: () => Promise.resolve(),
		},
	};
}

function configFor(
	name: string,
	executable = "",
	flags = "",
	read: typeof localToolkit = localToolkit,
): ConnConfig {
	const { client, seen } = recording();
	const interp = new Interp({
		extensions: [
			mcpExtension({
				...mcpHost,
				client,
				toolkit: read({
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
				"--shared-browser-context",
			],
		});
	});

	it("runs Playwright's own command without its image under :local", () => {
		const conf = configFor(
			"playwright",
			"/nix/chrome",
			" :local t",
			bundledToolkit,
		);
		expect(conf).not.toHaveProperty("image");
		expect(conf).toMatchObject({ command: "npx" });
	});

	it("appends the headless flag under :headless", () => {
		const conf = configFor(
			"playwright",
			"/nix/chrome",
			" :local t :headless",
			bundledToolkit,
		);
		expect(conf.args?.at(-1)).toBe("--headless");
	});

	it("refuses :headless for a server without a headless mode", () => {
		expect(() => configFor("ocr", "", " :headless t")).toThrow(/headless/);
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

describe("the production toolkit runs a command only as an image's local setup", () => {
	for (const conf of bundledToolkit().all()) {
		it(`serves ${conf.name} from its own image or a remote url`, () => {
			if ("command" in conf) expect("image" in conf).toBe(true);
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

describe("the machine toolkit runs no container", () => {
	for (const conf of machineToolkit().all()) {
		it(`runs ${conf.name} as a command on the machine`, () => {
			expect("image" in conf).toBe(false);
			expect("url" in conf).toBe(false);
			expect("command" in conf).toBe(true);
		});
	}
});

describe("the desktop toolkit", () => {
	const bundled = bundledToolkit();
	const bridged = bridgedEntries(bundled, machineToolkit());
	const bundledNames = new Set(bundled.all().map((conf) => conf.name));

	it("bridges every local entry to the user's machine", () => {
		const all = [...bridged.own, ...bridged.variants];
		expect(all.map((conf) => conf.name).sort()).toEqual(
			machineToolkit()
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
