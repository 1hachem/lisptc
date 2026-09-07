import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { USER } from "../src/channels.ts";
import { Interp, prelude, runAsync, runSync, str } from "../src/lisp.ts";
import { mcpExtension } from "../src/mcp.ts";

async function evalStr(interp: Interp, code: string): Promise<string> {
	return str(await runAsync(interp, code));
}

async function evalOutput(interp: Interp, code: string): Promise<string> {
	let output = "";
	const stop = interp.channels.on(USER, (d) => {
		output += d.text;
	});
	try {
		await runAsync(interp, code);
		return output;
	} finally {
		stop();
	}
}

function mcpInterp(): Interp {
	return new Interp({ extensions: [mcpExtension()] });
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
		const out = await evalStr(
			interp,
			`(await (load-mcp :name "fx" :command "node" :args (quote ("--no-warnings" "--experimental-transform-types" "${FIXTURE}"))))`,
		);
		expect(out).toContain("fx/echo");
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

describe("mcp-shutdown undefines tool bindings", () => {
	const interp = mcpInterp();
	runSync(interp, prelude);

	it("removes <server>/<tool> globals so they error as void, not stale", async () => {
		expect(
			await evalStr(
				interp,
				`(await (load-mcp :name "sfx" :command "node" :args (quote ("--no-warnings" "--experimental-transform-types" "${FIXTURE}"))))`,
			),
		).toContain("sfx/echo");
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
	const interp = new Interp({ extensions: [mcpExtension({ toolkitJson })] });
	runSync(interp, prelude);

	afterAll(async () => {
		await runAsync(interp, "(mcp-shutdown)");
	});

	it("accepts :name alone, like the bare-name form", async () => {
		expect(await evalStr(interp, '(await (load-mcp :name "tk"))')).toContain(
			"tk/echo",
		);
		expect(await evalStr(interp, '(tk/echo :message "hi")')).toBe('"hi"');
	});

	it("accepts a bare name as a string, symbol or keyword", async () => {
		expect(await evalStr(interp, '(await (load-mcp "tk"))')).toContain(
			"tk/echo",
		);
		expect(await evalStr(interp, "(await (load-mcp :tk))")).toContain(
			"tk/echo",
		);
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

describe("doc enum rendering for MCP tools (stdio fixture)", () => {
	const interp = mcpInterp();
	runSync(interp, prelude);

	afterAll(async () => {
		await runAsync(interp, "(mcp-shutdown)");
	});

	it("surfaces an argument's enum allowed values", async () => {
		await evalStr(
			interp,
			`(await (load-mcp :name "en" :command "node" :args (quote ("--no-warnings" "--experimental-transform-types" "${ENUM_FIXTURE}"))))`,
		);
		const doc = await evalOutput(interp, "(doc 'en/render)");
		expect(doc).toContain("format");
		expect(doc).toContain("one of");
		expect(doc).toContain("png");
		expect(doc).toContain("jpeg");
	});
});

function loadForm(name: string, delayMs = 0): string {
	const env =
		delayMs > 0
			? ` :env (quote (("LISPTC_FIXTURE_DELAY_MS" . "${delayMs}")))`
			: "";
	return `(load-mcp :name "${name}" :command "node"${env} :args (quote ("--no-warnings" "--experimental-transform-types" "${FIXTURE}")))`;
}

describe("async MCP jobs", () => {
	const interp = mcpInterp();
	runSync(interp, prelude);

	afterAll(async () => {
		await runAsync(interp, "(mcp-shutdown)");
	});

	it("load-mcp returns a job immediately", async () => {
		expect(await evalStr(interp, `(setq j ${loadForm("afx", 300)})`)).toContain(
			"#<job",
		);
	});

	it("reports :pending before the job settles", async () => {
		expect(await evalStr(interp, "(job-status j)")).toBe(":pending");
	});

	it("await installs the bindings and returns the tool list", async () => {
		expect(await evalStr(interp, "(await j)")).toContain("afx/echo");
		expect(await evalStr(interp, "(job-status j)")).toBe(":done");
	});

	it("the tool works after await", async () => {
		expect(await evalStr(interp, '(afx/echo :message "hi")')).toBe('"hi"');
	});

	it("await is idempotent", async () => {
		expect(await evalStr(interp, "(await j)")).toContain("afx/echo");
	});

	it("rejects an invalid timeout even on a finalized job", async () => {
		await expect(runAsync(interp, "(await j -5)")).rejects.toThrow(
			/invalid await timeout/,
		);
	});

	it("await honors a timeout and leaves the job awaitable", async () => {
		await evalStr(interp, `(setq slow ${loadForm("slowfx", 2000)})`);
		await expect(runAsync(interp, "(await slow 1)")).rejects.toThrow(
			/timed out/,
		);
		expect(await evalStr(interp, "(job-status slow)")).toBe(":pending");
	});

	it("cancel aborts an in-flight job and stops tracking it", async () => {
		await evalStr(interp, `(setq killme ${loadForm("killme", 3000)})`);
		expect(await evalStr(interp, "(cancel killme)")).toBe("t");
		await expect(runAsync(interp, "(await killme 2000)")).rejects.toThrow(
			/no such job/,
		);
		expect(await evalStr(interp, "(list-mcps)")).not.toContain("killme");
	});

	it("await-all collects every job in order", async () => {
		const out = await evalStr(
			interp,
			`(await-all (list ${loadForm("allA", 50)} ${loadForm("allB", 100)}))`,
		);
		expect(out).toContain("allA/echo");
		expect(out).toContain("allB/echo");
	});

	it("treats a connected server with no tools as a failure, not :loaded", async () => {
		const load = `(load-mcp :name "degraded" :command "node" :args (quote ("--no-warnings" "--experimental-transform-types" "${EMPTY_FIXTURE}")))`;
		await expect(runAsync(interp, `(await ${load})`)).rejects.toThrow(
			/no tools/,
		);
		expect(await evalStr(interp, "(list-mcps)")).not.toContain("degraded");
		expect(await evalStr(interp, "(list-tools)")).not.toContain("degraded");
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
		await evalStr(interp, `(setq cSlow ${loadForm("concSlow", 4000)})`);
		await evalStr(interp, `(setq cFast ${loadForm("concFast", 50)})`);

		for (let i = 0; i < 100; i++) {
			if ((await evalStr(interp, "(job-status cFast)")) === ":done") break;
			await new Promise((res) => setTimeout(res, 20));
		}

		expect(await evalStr(interp, "(job-status cFast)")).toBe(":done");
		expect(await evalStr(interp, "(job-status cSlow)")).toBe(":pending");
		expect(await evalStr(interp, "(cancel cSlow)")).toBe("t");
	});

	it("await-any returns the first job to settle", async () => {
		const out = await evalStr(
			interp,
			`(await-any (list ${loadForm("anySlow", 600)} ${loadForm("anyFast", 50)}))`,
		);
		expect(out).toContain("anyFast/echo");
	});
});

describe("liveJobs reaping", () => {
	const interp = mcpInterp();
	runSync(interp, prelude);

	afterAll(async () => {
		await runAsync(interp, "(mcp-shutdown)");
	});

	it("does not retain a job in (jobs) after it is awaited, and stays flat across cycles", async () => {
		expect(await evalStr(interp, "(length (jobs))")).toBe("0");

		for (let i = 0; i < 3; i++) {
			await evalStr(interp, `(setq rj ${loadForm(`reap${i}`)})`);
			expect(await evalStr(interp, "(await rj)")).toContain(`reap${i}/echo`);
			expect(await evalStr(interp, "(length (jobs))")).toBe("0");
		}
	});

	it("keeps the cached result awaitable after reaping (idempotency preserved)", async () => {
		await evalStr(interp, `(setq cj ${loadForm("cachefx")})`);
		const first = await evalStr(interp, "(await cj)");
		expect(first).toContain("cachefx/echo");
		expect(await evalStr(interp, "(length (jobs))")).toBe("0");
		expect(await evalStr(interp, "(await cj)")).toBe(first);
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

	it("has no job built-ins", async () => {
		const interp = coreInterp();
		for (const name of [
			"await",
			"await-all",
			"await-any",
			"job-status",
			"jobs",
			"cancel",
		])
			await expect(evalStr(interp, `(${name})`)).rejects.toThrow(
				new RegExp(`undefined: ${name}`),
			);
	});
});
