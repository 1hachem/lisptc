import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { Interp, prelude, run, setWriter, str } from "../src/lisp.ts";
import { mcpExtension } from "../src/mcp.ts";

// Evaluate one or more Lisp forms and return the printed value of the last.
function evalStr(interp: Interp, code: string): string {
	return str(run(interp, code));
}

// Evaluate a program on an existing (possibly stateful) interp and return
// everything written by prin1/princ/terpri/print, e.g. `(doc 'name)`.
function evalOutput(interp: Interp, code: string): string {
	let output = "";
	const prev = setWriter((s) => {
		output += s;
	});
	try {
		run(interp, code);
		return output;
	} finally {
		setWriter(prev);
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
	run(interp, prelude);

	it("evaluates :keywords to themselves and prints with a colon", () => {
		expect(evalStr(interp, "(list :query 1 :limit 2)")).toBe(
			"(:query 1 :limit 2)",
		);
	});

	it("interns keywords so eq holds", () => {
		expect(evalStr(interp, "(eq :a :a)")).toBe("t");
	});

	it("does not break existing symbol evaluation", () => {
		expect(evalStr(interp, "(+ 1 2 3)")).toBe("6");
	});
});

describe("MCP integration (stdio fixture)", () => {
	const interp = mcpInterp();
	run(interp, prelude);

	afterAll(() => {
		run(interp, "(mcp-shutdown)");
	});

	it("loads a stdio server and expands its tools into bindings", () => {
		const out = evalStr(
			interp,
			`(await (load-mcp :name "fx" :command "node" :args (quote ("--no-warnings" "--experimental-transform-types" "${FIXTURE}"))))`,
		);
		expect(out).toContain("fx/echo");
	});

	it("lists loaded servers", () => {
		expect(evalStr(interp, "(list-mcps)")).toContain("fx");
		expect(evalStr(interp, "(list-mcps)")).toContain(":loaded");
	});

	it("calls a tool with native keyword syntax", () => {
		expect(evalStr(interp, '(fx/echo :message "hi")')).toBe('"hi"');
	});

	it("validates required arguments before calling", () => {
		expect(() => run(interp, "(fx/echo)")).toThrow(
			/required argument "message"/,
		);
	});

	it("renders documentation", () => {
		const doc = evalOutput(interp, "(doc 'fx/echo)");
		expect(doc).toContain("Echo back the given message");
		expect(doc).toContain("message");
		// Usage signature shows arg name, type and call order.
		expect(doc).toContain("(fx/echo :message :string)");
	});

	it("searches tools by keyword", () => {
		expect(evalStr(interp, '(search-tools "echo")')).toContain("fx/echo");
	});

	it("searches the toolkit's MCP servers by keyword", () => {
		const out = evalStr(interp, '(search-mcps "browser")');
		expect(out).toContain("playwright");
		expect(out).toContain(":unloaded");
	});

	it("binds a catch handler to the tool's descriptive error, not an internal op code", () => {
		const out = evalStr(interp, "(try (fx/boom) (catch (e) e))");
		expect(out).toContain("something specific broke");
		expect(out).not.toBe('"call-tool"');
	});

	it("unloads a server and removes its bindings", () => {
		expect(evalStr(interp, '(unload-mcp "fx")')).toContain("fx/echo");
		expect(() => run(interp, '(fx/echo :message "hi")')).toThrow(
			/void variable|undefined/,
		);
	});
});

describe("mcp-shutdown undefines tool bindings", () => {
	const interp = mcpInterp();
	run(interp, prelude);

	it("removes <server>/<tool> globals so they error as void, not stale", () => {
		// Load the fixture and confirm its tool symbol is bound and callable.
		expect(
			evalStr(
				interp,
				`(await (load-mcp :name "sfx" :command "node" :args (quote ("--no-warnings" "--experimental-transform-types" "${FIXTURE}"))))`,
			),
		).toContain("sfx/echo");
		expect(evalStr(interp, '(sfx/echo :message "hi")')).toBe('"hi"');

		// Shut down the broker: the tool binding must be gone entirely.
		expect(evalStr(interp, "(mcp-shutdown)")).toBe("t");
		expect(() => run(interp, "(progn sfx/echo)")).toThrow(
			/void variable|undefined/,
		);
		// And it must NOT surface as a stale "no such server" MCP error.
		expect(() => run(interp, '(sfx/echo :message "hi")')).not.toThrow(
			/no such server/,
		);
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
	run(interp, prelude);

	afterAll(() => {
		run(interp, "(mcp-shutdown)");
	});

	it("accepts :name alone, like the bare-name form", () => {
		expect(evalStr(interp, '(await (load-mcp :name "tk"))')).toContain(
			"tk/echo",
		);
		expect(evalStr(interp, '(tk/echo :message "hi")')).toBe('"hi"');
	});

	it("accepts a bare name as a string, symbol or keyword", () => {
		expect(evalStr(interp, '(await (load-mcp "tk"))')).toContain("tk/echo");
		expect(evalStr(interp, "(await (load-mcp :tk))")).toContain("tk/echo");
	});

	it("rejects an unknown name in either form", () => {
		expect(() => run(interp, '(load-mcp "nope")')).toThrow(
			/unknown predefined MCP server/,
		);
		expect(() => run(interp, '(load-mcp :name "nope")')).toThrow(
			/unknown predefined MCP server/,
		);
	});
});

describe("doc enum rendering for MCP tools (stdio fixture)", () => {
	const interp = mcpInterp();
	run(interp, prelude);

	afterAll(() => {
		run(interp, "(mcp-shutdown)");
	});

	it("surfaces an argument's enum allowed values", () => {
		evalStr(
			interp,
			`(await (load-mcp :name "en" :command "node" :args (quote ("--no-warnings" "--experimental-transform-types" "${ENUM_FIXTURE}"))))`,
		);
		const doc = evalOutput(interp, "(doc 'en/render)");
		expect(doc).toContain("format");
		expect(doc).toContain("one of");
		expect(doc).toContain("png");
		expect(doc).toContain("jpeg");
	});
});

// Build a load-mcp form for the fixture with an optional startup delay (ms).
function loadForm(name: string, delayMs = 0): string {
	const env =
		delayMs > 0
			? ` :env (quote (("LISPTC_FIXTURE_DELAY_MS" . "${delayMs}")))`
			: "";
	return `(load-mcp :name "${name}" :command "node"${env} :args (quote ("--no-warnings" "--experimental-transform-types" "${FIXTURE}")))`;
}

describe("async MCP jobs", () => {
	const interp = mcpInterp();
	run(interp, prelude);

	afterAll(() => {
		run(interp, "(mcp-shutdown)");
	});

	it("load-mcp returns a job immediately", () => {
		expect(evalStr(interp, `(setq j ${loadForm("afx", 300)})`)).toContain(
			"#<job",
		);
	});

	it("reports :pending before the job settles", () => {
		expect(evalStr(interp, "(job-status j)")).toBe(":pending");
	});

	it("await installs the bindings and returns the tool list", () => {
		expect(evalStr(interp, "(await j)")).toContain("afx/echo");
		expect(evalStr(interp, "(job-status j)")).toBe(":done");
	});

	it("the tool works after await", () => {
		expect(evalStr(interp, '(afx/echo :message "hi")')).toBe('"hi"');
	});

	it("await is idempotent", () => {
		expect(evalStr(interp, "(await j)")).toContain("afx/echo");
	});

	it("rejects an invalid timeout even on a finalized job", () => {
		// `j` is already finalized (awaited above); an invalid timeout must still
		// be rejected, matching the behavior on a fresh job.
		expect(() => run(interp, "(await j -5)")).toThrow(/invalid await timeout/);
	});

	it("await honors a timeout and leaves the job awaitable", () => {
		evalStr(interp, `(setq slow ${loadForm("slowfx", 2000)})`);
		expect(() => run(interp, "(await slow 1)")).toThrow(/timed out/);
		// Still pending, not finalized — a real await can still collect it.
		expect(evalStr(interp, "(job-status slow)")).toBe(":pending");
	});

	it("cancel aborts an in-flight job and stops tracking it", () => {
		// A slow-connecting load, cancelled before it can finish.
		evalStr(interp, `(setq killme ${loadForm("killme", 3000)})`);
		expect(evalStr(interp, "(cancel killme)")).toBe("t");
		// The job is gone from the broker (aborted), so awaiting it errors and it
		// never becomes a loaded server.
		expect(() => run(interp, "(await killme 2000)")).toThrow(/no such job/);
		expect(evalStr(interp, "(list-mcps)")).not.toContain("killme");
	});

	it("await-all collects every job in order", () => {
		const out = evalStr(
			interp,
			`(await-all (list ${loadForm("allA", 50)} ${loadForm("allB", 100)}))`,
		);
		expect(out).toContain("allA/echo");
		expect(out).toContain("allB/echo");
	});

	it("treats a connected server with no tools as a failure, not :loaded", () => {
		const load = `(load-mcp :name "degraded" :command "node" :args (quote ("--no-warnings" "--experimental-transform-types" "${EMPTY_FIXTURE}")))`;
		expect(() => run(interp, `(await ${load})`)).toThrow(/no tools/);
		// It must NOT linger as a loaded server, and must expose no tools.
		expect(evalStr(interp, "(list-mcps)")).not.toContain("degraded");
		expect(evalStr(interp, "(list-tools)")).not.toContain("degraded");
	});

	it("auto-installs a finished load without an explicit await", async () => {
		// Fire and forget — never await this job.
		evalStr(interp, `(setq r ${loadForm("autofx")})`);
		// Let the event loop turn; the broker's job-settled push installs the
		// tools on its own. Poll the observable outcome, not the job.
		let out = "";
		for (let i = 0; i < 100; i++) {
			out = evalStr(interp, '(search-tools "echo")');
			if (out.includes("autofx/echo")) break;
			await new Promise((res) => setTimeout(res, 50));
		}
		expect(out).toContain("autofx/echo");
		expect(evalStr(interp, "(list-mcps)")).toContain("autofx");
		// The binding was installed automatically, so it is directly callable.
		expect(evalStr(interp, '(autofx/echo :message "yo")')).toBe('"yo"');
	});

	it("runs two loads concurrently, not sequentially", async () => {
		// A 4s load and a 50ms one, started together. A sequential broker would have
		// to finish the first before starting the second, so the second could never
		// settle while the first is still pending. Asserting on the two jobs' states
		// rather than on elapsed time keeps this independent of how loaded the
		// machine is: an earlier wall-clock version compared a two-load run against a
		// single-load baseline, and flaked whenever CPU contention made the two
		// simultaneous node spawns cost more than the one the baseline measured.
		evalStr(interp, `(setq cSlow ${loadForm("concSlow", 4000)})`);
		evalStr(interp, `(setq cFast ${loadForm("concFast", 50)})`);

		for (let i = 0; i < 100; i++) {
			if (evalStr(interp, "(job-status cFast)") === ":done") break;
			await new Promise((res) => setTimeout(res, 20));
		}

		expect(evalStr(interp, "(job-status cFast)")).toBe(":done");
		expect(evalStr(interp, "(job-status cSlow)")).toBe(":pending");
		expect(evalStr(interp, "(cancel cSlow)")).toBe("t");
	});

	it("await-any returns the first job to settle", () => {
		// anyFast (50ms) beats anySlow (600ms), so its bindings come back.
		const out = evalStr(
			interp,
			`(await-any (list ${loadForm("anySlow", 600)} ${loadForm("anyFast", 50)}))`,
		);
		expect(out).toContain("anyFast/echo");
	});
});

describe("liveJobs reaping", () => {
	const interp = mcpInterp();
	run(interp, prelude);

	afterAll(() => {
		run(interp, "(mcp-shutdown)");
	});

	it("does not retain a job in (jobs) after it is awaited, and stays flat across cycles", () => {
		// Baseline: no jobs before any load.
		expect(evalStr(interp, "(length (jobs))")).toBe("0");

		for (let i = 0; i < 3; i++) {
			evalStr(interp, `(setq rj ${loadForm(`reap${i}`)})`);
			expect(evalStr(interp, "(await rj)")).toContain(`reap${i}/echo`);
			// Settled job is reaped, so (jobs) returns to baseline each cycle.
			expect(evalStr(interp, "(length (jobs))")).toBe("0");
		}
	});

	it("keeps the cached result awaitable after reaping (idempotency preserved)", () => {
		evalStr(interp, `(setq cj ${loadForm("cachefx")})`);
		const first = evalStr(interp, "(await cj)");
		expect(first).toContain("cachefx/echo");
		// The handle is gone from (jobs) but a second await still returns cached.
		expect(evalStr(interp, "(length (jobs))")).toBe("0");
		expect(evalStr(interp, "(await cj)")).toBe(first);
	});
});
