import type { SecretsStore } from "@repo/interpreter/secrets";
import type { AgentRepl } from "@repo/repl/repl";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { type Harness, tracedRepl } from "../src/harness.ts";
import type { MockSpec } from "../src/mocks.ts";
import type { Trace } from "../src/trace.ts";

const PLAYWRIGHT: MockSpec = {
	servers: {
		playwright: {
			connectDelayMs: 30,
			tools: [
				{
					name: "browser_navigate",
					description: "Navigate to a URL",
					inputSchema: {
						type: "object",
						properties: { url: { type: "string" } },
						required: ["url"],
					},
				},
				{ name: "browser_snapshot", description: "Snapshot the page" },
			],
			calls: {
				browser_navigate: () => ({ ok: true }),
				browser_snapshot: { heading: "hyko" },
			},
		},
	},
};

function replFor(spec: MockSpec): Harness {
	return tracedRepl({ mocks: spec });
}

describe("a mocked MCP server", () => {
	let repl: AgentRepl;
	let trace: Trace;

	beforeEach(() => {
		({ repl, trace } = replFor(PLAYWRIGHT));
	});

	test("loads by its toolkit name and mints the real bindings", async () => {
		const out = await repl.eval('(await (load-mcp "playwright"))');

		expect(out).toContain("playwright/browser_navigate");
		const doc = await repl.evalOutput("(doc 'playwright/browser_navigate)");
		expect(doc.user).toContain("Navigate to a URL");
		expect(doc.user).toContain("(playwright/browser_navigate :url :string)");
	});

	test("records the call under the server name, with its arguments", async () => {
		await repl.eval('(await (load-mcp "playwright"))');
		await repl.eval('(playwright/browser_navigate :url "https://hyko.ai")');

		expect(trace.events).toContainEqual(
			expect.objectContaining({
				kind: "connect",
				server: "playwright",
				ok: true,
			}),
		);
		expect(trace.events).toContainEqual(
			expect.objectContaining({
				kind: "tool",
				server: "playwright",
				tool: "browser_navigate",
				args: { url: "https://hyko.ai" },
				ok: true,
			}),
		);
	});

	test("still validates arguments against the tool schema", async () => {
		await repl.eval('(await (load-mcp "playwright"))');

		expect(await repl.eval("(playwright/browser_navigate)")).toContain("url");
	});

	test("a slow connect is still pending on the next step", async () => {
		await repl.eval('(load-mcp "playwright")');

		expect(await repl.eval("(promise-state load-mcp-1)")).toContain("pending");
	});

	test("a tool error reaches Lisp as an error, not a value", async () => {
		({ repl, trace } = replFor({
			servers: {
				flaky: { tools: [{ name: "go" }], calls: { go: { error: "boom" } } },
			},
		}));
		await repl.eval('(await (load-mcp :name "flaky" :command "none"))');

		expect(await repl.eval("(flaky/go)")).toContain("boom");
		expect(trace.events).toContainEqual(
			expect.objectContaining({ kind: "tool", tool: "go", ok: false }),
		);
	});

	test("an unmocked server fails in-world, and warns its author", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const output = await repl.eval('(await (load-mcp "linear"))');
		expect(output).toContain('cannot start MCP server "linear"');
		expect(output).not.toContain("mock");
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining("no mock for MCP server"),
		);
		warn.mockRestore();
	});

	test("a secret never lands in the trace", async () => {
		let secrets: SecretsStore;
		({ repl, trace, secrets } = replFor({
			servers: {
				api: { tools: [{ name: "send" }], calls: { send: { ok: true } } },
			},
		}));
		secrets.set({ REPL_TOKEN: "s3cr3t-value" });
		await repl.eval('(await (load-mcp :name "api" :command "none"))');
		await repl.eval('(api/send :token (secret "REPL_TOKEN"))');

		const call = trace.events.find((e) => e.kind === "tool");
		expect(JSON.stringify(call)).not.toContain("s3cr3t-value");
		expect(JSON.stringify(call)).toContain("<redacted>");
	});
});
