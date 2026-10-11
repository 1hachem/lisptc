import { fileURLToPath } from "node:url";
import { Interp, runSync } from "@repo/interpreter/lisp";
import { prelude } from "@repo/interpreter/prelude";
import { str } from "@repo/interpreter/print";
import { describe, expect, it } from "vitest";
import { mcpExtension } from "../src/mcp.ts";
import { localMcpClient, mcpHost } from "../src/mcp-host.ts";
import type { McpPolicy, ServerAccess } from "../src/ports.ts";
import { recordingHost } from "./helpers.ts";

const FIXTURE = fileURLToPath(
	new URL("./fixture-mcp-server.ts", import.meta.url),
);

const LOAD_FX = `(load-mcp :name "fx" :command "node" :args (quote ("--no-warnings" "--experimental-transform-types" "${FIXTURE}")))`;

function interpWith(policy: McpPolicy): Interp {
	const interp = new Interp({
		extensions: [
			mcpExtension({
				...mcpHost,
				client: localMcpClient({ host: recordingHost() }),
				policy,
			}),
		],
	});
	runSync(interp, prelude);
	return interp;
}

function serverPolicy(access: ServerAccess): McpPolicy {
	return { server: () => access, tool: () => true };
}

describe("the mcp policy port", () => {
	it("never lets a tool the policy hides be listed or called", async () => {
		const interp = interpWith({
			server: () => ({ access: "open" }),
			tool: (_server, tool) => tool !== "boom",
		});
		const tools = str(await (runSync(interp, LOAD_FX) as Promise<unknown>));
		expect(tools).toContain("fx/echo");
		expect(tools).not.toContain("fx/boom");
		expect(() => runSync(interp, "(fx/boom)")).toThrow("unknown MCP tool");
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
		expect(() => runSync(interp, LOAD_FX)).toThrow("unknown MCP server");
		expect(str(runSync(interp, "(list-toolkit)"))).toBe("nil");
	});

	describe("a policy that changes", () => {
		function changing() {
			const hidden = new Set<string>();
			let access: ServerAccess = { access: "open" };
			const policy: McpPolicy = {
				server: () => access,
				tool: (_server, tool) => !hidden.has(tool),
			};
			return {
				policy,
				hide: (tool: string) => hidden.add(tool),
				show: (tool: string) => hidden.delete(tool),
				server: (next: ServerAccess) => {
					access = next;
				},
			};
		}

		it("refuses and stops listing a tool hidden after load, and offers it again once shown", async () => {
			const live = changing();
			const interp = interpWith(live.policy);
			await (runSync(interp, LOAD_FX) as Promise<unknown>);
			live.hide("echo");
			expect(() => runSync(interp, '(fx/echo :message "x")')).toThrow(
				"unknown MCP tool",
			);
			expect(str(runSync(interp, '(list-tools "fx")'))).not.toContain(
				"fx/echo",
			);
			live.show("echo");
			expect(str(runSync(interp, '(list-tools "fx")'))).toContain("fx/echo");
			interp.dispose();
		}, 30_000);

		it("refuses a loaded server's tools once it is denied, with the reason", async () => {
			const live = changing();
			const interp = interpWith(live.policy);
			await (runSync(interp, LOAD_FX) as Promise<unknown>);
			live.server({ access: "denied", reason: "no fixtures" });
			expect(() => runSync(interp, '(fx/echo :message "x")')).toThrow(
				"MCP server denied: no fixtures",
			);
			expect(str(runSync(interp, '(list-tools "fx")'))).toBe("nil");
			interp.dispose();
		}, 30_000);

		it("stops showing a loaded server once it is hidden", async () => {
			const live = changing();
			const interp = interpWith(live.policy);
			await (runSync(interp, LOAD_FX) as Promise<unknown>);
			live.server({ access: "hidden" });
			expect(str(runSync(interp, "(list-mcps)"))).not.toContain("fx");
			expect(() => runSync(interp, '(fx/echo :message "x")')).toThrow(
				"unknown MCP server",
			);
			interp.dispose();
		}, 30_000);
	});
});
