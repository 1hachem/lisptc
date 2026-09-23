import { fileURLToPath } from "node:url";
import { bufferTransport } from "@repo/interpreter/channels-host";
import {
	Interp,
	prelude,
	runAsync,
	runSync,
	str,
} from "@repo/interpreter/lisp";
import { afterAll, describe, expect, it } from "vitest";
import { mcpExtension } from "../src/mcp.ts";
import { mcpHost } from "../src/mcp-host.ts";
import type { SearchDocument, SearchEngine } from "../src/ports.ts";
import { jsonToolkit } from "../src/toolkit.ts";

async function evalStr(interp: Interp, code: string): Promise<string> {
	return str((await runAsync(interp, code)).value);
}

async function evalOutput(interp: Interp, code: string): Promise<string> {
	const buffer = bufferTransport();
	const detach = interp.channels.pipe(buffer);
	try {
		await runAsync(interp, code);
		return buffer.collectText("user");
	} finally {
		detach();
	}
}

function mcpInterp(): Interp {
	return new Interp({ extensions: [mcpExtension(mcpHost)] });
}

function start(interp: Interp, form: string): Promise<unknown> {
	return runSync(interp, form) as Promise<unknown>;
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
const ENUM_FIXTURE = fileURLToPath(
	new URL("./fixture-enum-mcp-server.ts", import.meta.url),
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
	runSync(interp, prelude);

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
	runSync(interp, prelude);

	afterAll(async () => {
		await runAsync(interp, "(mcp-shutdown)");
	});

	it("loads a stdio server and expands its tools into bindings", async () => {
		expect(await load(interp, loadForm("fx"))).toContain("fx/echo");
	});

	it("lists loaded servers", async () => {
		expect(await evalStr(interp, "(list-mcps)")).toContain("fx");
		expect(await evalStr(interp, "(list-mcps)")).toContain(":loaded");
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

	it("renders documentation", async () => {
		const doc = await evalOutput(interp, "(doc 'fx/echo)");
		expect(doc).toContain("Echo back the given message");
		expect(doc).toContain("message");
		expect(doc).toContain("(fx/echo :message :string)");
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

	it("lists every toolkit server's keywords, so search has words to use", async () => {
		const out = await evalStr(interp, "(list-toolkit)");
		expect(out).toContain("vision");
		expect(out).toContain("spreadsheet");
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
	const documents: SearchDocument[][] = [];
	const search: SearchEngine = {
		search(_query, candidates) {
			documents.push([...candidates]);
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
				search,
				toolkit: jsonToolkit(toolkitJson),
			}),
		],
	});
	runSync(interp, prelude);

	afterAll(async () => {
		await runAsync(interp, "(mcp-shutdown)");
	});

	it("delegates MCP and loaded-tool ranking through the injected engine", async () => {
		expect(await evalStr(interp, '(search-mcps "anything")')).toContain(
			"search-fixture",
		);
		expect(documents[0]).toEqual([
			{
				id: "search-fixture",
				name: "search-fixture",
				keywords: ["search-keyword"],
				description: "search description",
			},
		]);

		await load(interp, '(load-mcp "search-fixture")');
		expect(await evalStr(interp, '(search-tools "anything")')).toContain(
			"search-fixture/echo",
		);
		expect(documents[1]).toContainEqual({
			id: "search-fixture/echo",
			name: "search-fixture/echo",
			description: "Echo back the given message.",
		});
	});
});

describe("mcp-shutdown undefines tool bindings", () => {
	const interp = mcpInterp();
	runSync(interp, prelude);

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
			mcpExtension({ ...mcpHost, toolkit: jsonToolkit(toolkitJson) }),
		],
	});
	runSync(interp, prelude);

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
			mcpExtension({ ...mcpHost, toolkit: jsonToolkit(toolkitJson) }),
		],
	});
	runSync(interp, prelude);

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
			mcpExtension({ ...mcpHost, toolkit: jsonToolkit(toolkitJson) }),
		],
	});
	runSync(interp, prelude);

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

describe("doc enum rendering for MCP tools (stdio fixture)", () => {
	const interp = mcpInterp();
	runSync(interp, prelude);

	afterAll(async () => {
		await runAsync(interp, "(mcp-shutdown)");
	});

	it("surfaces an argument's enum allowed values", async () => {
		await load(
			interp,
			`(load-mcp :name "en" :command "node" :args (quote ("--no-warnings" "--experimental-transform-types" "${ENUM_FIXTURE}")))`,
		);
		const doc = await evalOutput(interp, "(doc 'en/render)");
		expect(doc).toContain("format");
		expect(doc).toContain("one of");
		expect(doc).toContain("png");
		expect(doc).toContain("jpeg");
	});
});

describe("the MCP extension adds no promise vocabulary of its own", () => {
	const interp = mcpInterp();
	runSync(interp, prelude);

	afterAll(async () => {
		await runAsync(interp, "(mcp-shutdown)");
	});

	it("starts a load, installs the bindings, and offers no await", async () => {
		const promise = start(interp, loadForm("alone"));
		expect(promise).toBeInstanceOf(Promise);
		expect(str(await promise)).toContain("alone/echo");
		expect(await evalStr(interp, '(alone/echo :message "hi")')).toBe('"hi"');
		expect(() => runSync(interp, "(await 1)")).toThrow(/undefined: await/);
	});
});

describe("a load runs in the background", () => {
	const interp = mcpInterp();
	runSync(interp, prelude);

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

	it("runs two loads concurrently, not sequentially", async () => {
		const slow = start(interp, loadForm("concSlow", 4000));
		slow.catch(() => {});
		const fast = start(interp, loadForm("concFast", 50));
		await fast;

		expect(interp.async.stateOf(fast)).toBe("fulfilled");
		expect(interp.async.stateOf(slow)).toBe("pending");
		expect(interp.async.cancel(slow)).toBe(true);
	});

	it("cancelling a load rejects it and leaves no server behind", async () => {
		const killme = start(interp, loadForm("killme", 3000));
		expect(interp.async.cancel(killme)).toBe(true);
		await expect(killme).rejects.toThrow();
		expect(interp.async.stateOf(killme)).toBe("rejected");
		expect(await evalStr(interp, "(list-mcps)")).not.toContain("killme");
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
		runSync(interp, prelude);
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
