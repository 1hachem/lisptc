import { Interp, runSync } from "@repo/interpreter/lisp";
import { prelude } from "@repo/interpreter/prelude";
import { str } from "@repo/interpreter/print";
import { describe, expect, it } from "vitest";
import { mcpExtension } from "../src/mcp.ts";
import { localMcpClient, mcpHost } from "../src/mcp-host.ts";
import { MemoryOAuthStore } from "../src/oauth-host.ts";
import type { McpPolicy, ServerAccess } from "../src/ports.ts";
import { fixtureServer, recordingHost, withServers } from "./helpers.ts";

const LOAD_FX = '(load-mcp "fx")';

function interpWith(policy: McpPolicy): Interp {
	const interp = new Interp({
		extensions: [
			mcpExtension(
				withServers(
					{
						...mcpHost,
						client: localMcpClient({
							host: recordingHost(),
							oauth: new MemoryOAuthStore(),
						}),
						policy,
					},
					fixtureServer("fx"),
				),
			),
		],
	});
	runSync(interp, prelude);
	return interp;
}

function serverPolicy(access: ServerAccess): McpPolicy {
	return { server: () => access, tool: () => true };
}

describe("the mcp policy port", () => {
	it("never binds a tool the policy hides", async () => {
		const interp = interpWith({
			server: () => ({ access: "open" }),
			tool: (_server, tool) => tool !== "boom",
		});
		const tools = str(await (runSync(interp, LOAD_FX) as Promise<unknown>));
		expect(tools).toContain("fx/echo");
		expect(tools).not.toContain("fx/boom");
		expect(() => runSync(interp, "(fx/boom)")).toThrow("undefined");
		interp.dispose();
	}, 30_000);

	it("refuses to load a denied server, with the reason", () => {
		const interp = interpWith(
			serverPolicy({ access: "denied", reason: "no fixtures" }),
		);
		expect(() => runSync(interp, LOAD_FX)).toThrow(
			"MCP server denied: no fixtures",
		);
	});

	it("treats a hidden server as one that does not exist", () => {
		const interp = interpWith(serverPolicy({ access: "hidden" }));
		expect(() => runSync(interp, LOAD_FX)).toThrow(
			"unknown predefined MCP server",
		);
		expect(str(runSync(interp, "(list-toolkit)"))).toBe("nil");
	});
});

describe("load-mcp's name argument", () => {
	it("lists the toolkit servers the policy shows, with their descriptions", () => {
		const interp = new Interp({
			extensions: [
				mcpExtension({
					...mcpHost,
					toolkit: {
						all: () => [
							{ name: "shown", description: "A shown server.", url: "x" },
							{ name: "secret", url: "x" },
						],
					},
					policy: {
						server: (name) =>
							name === "secret" ? { access: "hidden" } : { access: "open" },
						tool: () => true,
					},
				}),
			],
		});
		const name = interp
			.docs()
			.get("load-mcp")
			?.args?.find((arg) => arg.name === "name");
		expect(name?.values).toEqual([
			{ value: "shown", description: "A shown server." },
		]);
	});
});
