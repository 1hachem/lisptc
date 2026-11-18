import { fileURLToPath } from "node:url";
import { boot, Interp, runAsync, runSync } from "@repo/interpreter/lisp";
import { str } from "@repo/interpreter/print";
import { LispPromise } from "@repo/interpreter/promise";
import type { SearchEngine } from "@repo/shared/search";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mcpExtension } from "../src/mcp.ts";
import { mcpHost } from "../src/mcp-host.ts";
import { jsonToolkit } from "../src/toolkit.ts";

async function evalStr(interp: Interp, code: string): Promise<string> {
	return str((await runAsync(interp, code)).value);
}

function mcpInterp(): Interp {
	return new Interp({
		extensions: [mcpExtension({ ...mcpHost, commands: true })],
	});
}

function start(interp: Interp, form: string): LispPromise {
	return runSync(interp, form) as LispPromise;
}

async function load(interp: Interp, form: string): Promise<string> {
	return str(await start(interp, form));
}

const FIXTURE = fileURLToPath(
	new URL("./fixture-mcp-server.ts", import.meta.url),
);
const EMPTY_FIXTURE = fileURLToPath(
	new URL("./fixture-empty-mcp-server.ts", import.meta.url),
);

function loadForm(name: string, delayMs = 0): string {
	const env =
		delayMs > 0
			? ` :env (quote (("LISPTC_FIXTURE_DELAY_MS" . "${delayMs}")))`
			: "";
	return `(load-mcp :name "${name}" :command "node"${env} :args (quote ("--no-warnings" "--experimental-transform-types" "${FIXTURE}")))`;
}

describe("self-evaluating keywords", () => {
	const interp = new Interp();
	boot(interp);

	it("evaluates :keywords to themselves and prints with a colon", async () => {
		expect(await evalStr(interp, "(list :query 1 :limit 2)")).toBe(
			"(:query 1 :limit 2)",
		);
	});

	it("interns keywords so eq holds", async () => {
		expect(await evalStr(interp, "(eq :a :a)")).toBe("t");
	});

	it("does not break existing symbol evaluation", async () => {
		expect(await evalStr(interp, "(+ 1 2 3)")).toBe("6");
	});
});

describe("MCP integration (stdio fixture)", () => {
	const interp = mcpInterp();
	boot(interp);

	beforeAll(async () => {
		await start(interp, loadForm("fx"));
	});

	afterAll(async () => {
		await runAsync(interp, "(mcp-shutdown)");
	});

	it("lists several named servers, refusing one that is not loaded", async () => {
		expect(await evalStr(interp, '(list-tools "fx" "fx")')).toContain(
			"fx/echo",
		);
		await expect(evalStr(interp, '(list-tools "fx" "nope")')).rejects.toThrow(
			/MCP server not loaded/,
		);
	});

	it("lists every loaded server's tools without a server", async () => {
		expect(await evalStr(interp, "(list-tools)")).toContain("fx/echo");
	});

	it("calls a tool with native keyword syntax", async () => {
		expect(await evalStr(interp, '(fx/echo :message "hi")')).toBe('"hi"');
	});

	it("parses a JSON text result into data", async () => {
		expect(await evalStr(interp, '(cdr (assoc "hasMore" (fx/issues)))')).toBe(
			"nil",
		);
		expect(
			await evalStr(
				interp,
				'(cdr (assoc "title" (car (cdr (assoc "issues" (fx/issues))))))',
			),
		).toBe('"Auth token refresh fails"');
	});

	it("leaves a plain text result alone", async () => {
		expect(await evalStr(interp, '(fx/echo :message "42")')).toBe('"42"');
		expect(await evalStr(interp, '(fx/echo :message "null")')).toBe('"null"');
	});

	it("validates required arguments before calling", async () => {
		await expect(runAsync(interp, "(fx/echo)")).rejects.toThrow(
			/required argument "message"/,
		);
	});

	it("searches tools by keyword", async () => {
		expect(await evalStr(interp, '(search-tools "echo")')).toContain("fx/echo");
	});

	it("searches the toolkit's MCP servers by keyword", async () => {
		const out = await evalStr(interp, '(search-mcps "browser")');
		expect(out).toContain("playwright");
		expect(out).toContain(":unloaded");
	});

	it("finds a toolkit server by a keyword its description never uses", async () => {
		expect(await evalStr(interp, '(search-mcps "vision")')).toContain("ocr");
		expect(await evalStr(interp, '(search-mcps "spreadsheet")')).toContain(
			"sheets",
		);
		expect(await evalStr(interp, '(search-mcps "tickets")')).toContain(
			"linear",
		);
	});

	it("ranks a keyword hit above a passing mention in a description", async () => {
		const out = await evalStr(interp, '(search-mcps "read")');
		expect(out.indexOf("fs")).toBeGreaterThan(-1);
		expect(out.indexOf("fs")).toBeLessThan(out.indexOf("ocr"));
	});

	it("returns every server a shared keyword fits", async () => {
		const out = await evalStr(interp, '(search-mcps "screenshot")');
		expect(out).toContain("playwright");
		expect(out).toContain("ocr");
	});

	it("ignores a query's stopwords instead of matching them everywhere", async () => {
		const out = await evalStr(interp, '(search-mcps "read a receipt")');
		expect(out).toContain("ocr");
		expect(out).not.toContain("posthog");
	});

	it("binds a catch handler to the tool's descriptive error, not an internal op code", async () => {
		const out = await evalStr(interp, "(try (fx/boom) (catch (e) e))");
		expect(out).toContain("something specific broke");
		expect(out).not.toBe('"call-tool"');
	});

	it("unloads a server and removes its bindings", async () => {
		expect(await evalStr(interp, '(unload-mcp "fx")')).toContain("fx/echo");
		await expect(runAsync(interp, '(fx/echo :message "hi")')).rejects.toThrow(
			/void variable|undefined/,
		);
	});
});

describe("MCP search engine", () => {
	const search: SearchEngine = {
		search(_query, candidates) {
			return candidates.map((candidate, index) => ({
				id: candidate.id,
				score: index + 1,
			}));
		},
	};
	const toolkitJson = JSON.stringify([
		{
			name: "search-fixture",
			description: "search description",
			keywords: ["search-keyword"],
			command: "node",
			args: ["--no-warnings", "--experimental-transform-types", FIXTURE],
		},
	]);
	const interp = new Interp({
		extensions: [
			mcpExtension({
				...mcpHost,
				commands: true,
				search,
				toolkit: jsonToolkit(toolkitJson),
			}),
		],
	});
	boot(interp);

	afterAll(async () => {
		await runAsync(interp, "(mcp-shutdown)");
	});

	it("delegates MCP and loaded-tool ranking through the injected engine", async () => {
		expect(await evalStr(interp, '(search-mcps "anything")')).toContain(
			"search-fixture",
		);
		await load(interp, '(load-mcp "search-fixture")');
		expect(await evalStr(interp, '(search-tools "anything")')).toContain(
			"search-fixture/echo",
		);
	});
});

describe("mcp-shutdown undefines tool bindings", () => {
	const interp = mcpInterp();
	boot(interp);

	it("removes <server>/<tool> globals so they error as void, not stale", async () => {
		expect(await load(interp, loadForm("sfx"))).toContain("sfx/echo");
		expect(await evalStr(interp, '(sfx/echo :message "hi")')).toBe('"hi"');

		expect(await evalStr(interp, "(mcp-shutdown)")).toBe("t");
		await expect(runAsync(interp, "(progn sfx/echo)")).rejects.toThrow(
			/void variable|undefined/,
		);
		await expect(
			runAsync(interp, '(sfx/echo :message "hi")'),
		).rejects.not.toThrow(/no such server/);
	});
});

describe("loading a toolkit server by name", () => {
	const toolkitJson = JSON.stringify([
		{
			name: "tk",
			description: "toolkit fixture",
			command: "node",
			args: ["--no-warnings", "--experimental-transform-types", FIXTURE],
		},
	]);
	const interp = new Interp({
		extensions: [
			mcpExtension({
				...mcpHost,
				commands: true,
				toolkit: jsonToolkit(toolkitJson),
			}),
		],
	});
	boot(interp);

	afterAll(async () => {
		await runAsync(interp, "(mcp-shutdown)");
	});

	it("accepts :name alone, like the bare-name form", async () => {
		expect(await load(interp, '(load-mcp :name "tk")')).toContain("tk/echo");
		expect(await evalStr(interp, '(tk/echo :message "hi")')).toBe('"hi"');
	});

	it("accepts a bare name as a string, symbol or keyword", async () => {
		expect(await load(interp, '(load-mcp "tk")')).toContain("tk/echo");
		expect(await load(interp, "(load-mcp :tk)")).toContain("tk/echo");
	});

	it("rejects an unknown name in either form", async () => {
		await expect(runAsync(interp, '(load-mcp "nope")')).rejects.toThrow(
			/unknown predefined MCP server/,
		);
		await expect(runAsync(interp, '(load-mcp :name "nope")')).rejects.toThrow(
			/unknown predefined MCP server/,
		);
	});
});

describe("a url server the interpreter starts for you", () => {
	const toolkitJson = JSON.stringify([
		{
			name: "managed",
			description: "an http server with a start command",
			url: "http://127.0.0.1:8998/mcp-extension",
			command: "node",
			args: ["-e", "console.error('no secrets for you'); process.exit(3)"],
		},
	]);
	const interp = new Interp({
		extensions: [
			mcpExtension({
				...mcpHost,
				commands: true,
				toolkit: jsonToolkit(toolkitJson),
			}),
		],
	});
	boot(interp);

	afterAll(async () => {
		await runAsync(interp, "(mcp-shutdown)");
	});

	it("reports the exit code and the server's own stderr", async () => {
		await expect(start(interp, '(load-mcp "managed")')).rejects.toThrow(
			/exited with code 3[\s\S]*no secrets for you/,
		);
	});
});

describe("a toolkit server bundled with the repo", () => {
	const toolkitJson = JSON.stringify([
		{
			name: "bundled",
			description: "reached by a path relative to the toolkit file",
			command: "node",
			args: [
				"--no-warnings",
				"--experimental-transform-types",
				"./test/fixture-mcp-server.ts",
			],
		},
	]);
	const interp = new Interp({
		extensions: [
			mcpExtension({
				...mcpHost,
				commands: true,
				toolkit: jsonToolkit(
					toolkitJson,
					undefined,
					new URL("../package.json", import.meta.url),
				),
			}),
		],
	});
	boot(interp);

	afterAll(async () => {
		await runAsync(interp, "(mcp-shutdown)");
	});

	it("resolves a relative arg against the toolkit file, not the cwd", async () => {
		expect(await load(interp, '(load-mcp "bundled")')).toContain(
			"bundled/echo",
		);
		expect(await evalStr(interp, '(bundled/echo :message "hi")')).toBe('"hi"');
	});
});

describe("the MCP extension adds no promise vocabulary of its own", () => {
	const interp = mcpInterp();
	boot(interp);

	afterAll(async () => {
		await runAsync(interp, "(mcp-shutdown)");
	});

	it("starts a load, installs the bindings, and offers no await", async () => {
		const promise = start(interp, loadForm("alone"));
		expect(promise).toBeInstanceOf(LispPromise);
		expect(str(await promise)).toContain("alone/echo");
		expect(await evalStr(interp, '(alone/echo :message "hi")')).toBe('"hi"');
		expect(() => runSync(interp, "(await 1)")).toThrow(/undefined: await/);
	});
});

describe("a load runs in the background", () => {
	const interp = mcpInterp();
	boot(interp);

	afterAll(async () => {
		await runAsync(interp, "(mcp-shutdown)");
	});

	it("load-mcp returns a promise immediately", async () => {
		expect(await evalStr(interp, `(setq j ${loadForm("afx", 300)})`)).toBe(
			"#<promise>",
		);
	});

	it("auto-installs a finished load without an explicit await", async () => {
		await evalStr(interp, `(setq r ${loadForm("autofx")})`);
		let out = "";
		for (let i = 0; i < 100; i++) {
			out = await evalStr(interp, '(search-tools "echo")');
			if (out.includes("autofx/echo")) break;
			await new Promise((res) => setTimeout(res, 50));
		}
		expect(out).toContain("autofx/echo");
		expect(await evalStr(interp, "(list-mcps)")).toContain("autofx");
		expect(await evalStr(interp, '(autofx/echo :message "yo")')).toBe('"yo"');
	});

	it("finishes a quick load while a slow one started before it is still loading", async () => {
		const slow = start(interp, loadForm("concSlow", 2000));
		slow.then(undefined, () => {});
		await start(interp, loadForm("concFast", 50));
		const listed = await evalStr(interp, "(list-mcps)");
		expect(listed).toContain('("concFast" :loaded 3)');
		expect(listed).not.toContain("concSlow");
	});

	it("treats a connected server with no tools as a failure, not :loaded", async () => {
		const form = `(load-mcp :name "degraded" :command "node" :args (quote ("--no-warnings" "--experimental-transform-types" "${EMPTY_FIXTURE}")))`;
		await expect(start(interp, form)).rejects.toThrow(/no tools/);
		expect(await evalStr(interp, "(list-mcps)")).not.toContain("degraded");
		expect(await evalStr(interp, "(list-tools)")).not.toContain("degraded");
	});
});

describe("core interpreter (no mcp extension)", () => {
	function coreInterp(): Interp {
		const interp = new Interp();
		boot(interp);
		return interp;
	}

	it("has no mcp built-ins", async () => {
		const interp = coreInterp();
		for (const name of [
			"load-mcp",
			"unload-mcp",
			"list-mcps",
			"list-toolkit",
			"list-tools",
			"search-tools",
			"search-mcps",
			"mcp-shutdown",
		])
			await expect(evalStr(interp, `(${name})`)).rejects.toThrow(
				new RegExp(`undefined: ${name}`),
			);
	});

	it("has no promise built-ins", async () => {
		const interp = coreInterp();
		for (const name of [
			"await",
			"promise-all",
			"promise-all-settled",
			"promise-any",
			"promise-race",
			"promise-state",
			"promises",
			"cancel",
		])
			await expect(evalStr(interp, `(${name})`)).rejects.toThrow(
				new RegExp(`undefined: ${name}`),
			);
	});
});
