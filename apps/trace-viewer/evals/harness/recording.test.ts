import { Checks } from "@repo/checks/checks";
import type { Trace } from "@repo/checks/trace";
import { promisesExtension } from "@repo/promises-extension";
import { promisesHost } from "@repo/promises-extension/host";
import type { AgentRepl } from "@repo/repl/repl";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { type Harness, tracedRepl } from "./harness.ts";
import {
	type MockSpec,
	mockedMcpExtension,
	tracedSecretsExtension,
} from "./mocks.ts";

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
	return tracedRepl({
		mocks: spec,
		extensions: () => [
			tracedSecretsExtension(),
			promisesExtension(promisesHost),
			mockedMcpExtension({ commands: true }),
		],
	});
}

function verdict(trace: Trace, source: string): string {
	const checks = new Checks(trace, source);
	checks.evaluate(1);
	return checks.results()[0]?.verdict ?? "missing";
}

describe("a mocked MCP server", () => {
	let repl: AgentRepl;
	let trace: Trace;

	beforeEach(() => {
		({ repl, trace } = replFor(PLAYWRIGHT));
		trace.beginStep(1);
	});

	test("loads by its toolkit name and mints the real bindings", async () => {
		await repl.eval('(await (load-mcp "playwright"))');

		const doc = await repl.evalOutput("(doc 'playwright/browser_navigate)");
		expect(doc.user).toContain("Navigate to a URL");
		expect(doc.user).toContain("(playwright/browser_navigate :url :string)");
	});

	test("a check sees the call under the server name, with its arguments", async () => {
		await repl.eval('(await (load-mcp "playwright"))');
		await repl.eval('(playwright/browser_navigate :url "https://hyko.ai")');

		expect(
			verdict(
				trace,
				'(defcheck it (eventually (called "playwright/browser_navigate" :url (matches "hyko"))))',
			),
		).toBe("true");
		expect(
			verdict(trace, '(defcheck it (eventually (called-server "playwright")))'),
		).toBe("true");
	});

	test("still validates arguments against the tool schema", async () => {
		await repl.eval('(await (load-mcp "playwright"))');

		expect(await repl.eval("(playwright/browser_navigate)")).toContain("url");
	});

	test("a slow connect is still pending on the next step", async () => {
		await repl.eval('(setq p (load-mcp "playwright"))');

		const state = await repl.evalOutput("(echo (promise-state p))");
		expect(state.user).toContain(":pending");
	});

	test("a tool error reaches Lisp as an error, not a value", async () => {
		({ repl, trace } = replFor({
			servers: {
				flaky: { tools: [{ name: "go" }], calls: { go: { error: "boom" } } },
			},
		}));
		trace.beginStep(1);
		await repl.eval('(await (load-mcp :name "flaky" :command "none"))');

		expect(await repl.eval("(flaky/go)")).toContain("boom");
		expect(verdict(trace, "(defcheck it (eventually (errored)))")).toBe("true");
	});

	test("an unmocked server fails in-world without naming the mock", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const output = await repl.eval('(await (load-mcp "linear"))');
		expect(output).toContain('cannot start MCP server "linear"');
		expect(output).not.toContain("mock");
		warn.mockRestore();
	});

	test("keeps a secret passed to a tool out of the recorded trace", async () => {
		const run = replFor({
			servers: {
				api: { tools: [{ name: "send" }], calls: { send: { ok: true } } },
			},
		});
		run.secrets.set({ REPL_TOKEN: "s3cr3t-value" });
		run.trace.beginStep(1);
		await run.repl.eval('(await (load-mcp :name "api" :command "none"))');
		await run.repl.eval('(api/send :token (secret "REPL_TOKEN"))');

		expect(
			verdict(run.trace, '(defcheck it (eventually (called-server "api")))'),
		).toBe("true");
		expect(JSON.stringify(run.trace.events)).not.toContain("s3cr3t-value");
	});
});
