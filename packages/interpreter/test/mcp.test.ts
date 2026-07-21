import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { Interp, prelude, run, str } from "../src/lisp.ts";

// Evaluate one or more Lisp forms and return the printed value of the last.
function evalStr(interp: Interp, code: string): string {
	return str(run(interp, code));
}

const FIXTURE = fileURLToPath(
	new URL("./fixture-mcp-server.ts", import.meta.url),
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
	const interp = new Interp();
	run(interp, prelude);

	afterAll(() => {
		run(interp, "(mcp-shutdown)");
	});

	it("loads a stdio server and expands its tools into bindings", () => {
		const out = evalStr(
			interp,
			`(load-mcp :name "fx" :command "node" :args (quote ("--experimental-transform-types" "${FIXTURE}")))`,
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
		const doc = evalStr(interp, "(mcp-doc 'fx/echo)");
		expect(doc).toContain("Echo back the given message");
		expect(doc).toContain("message");
	});

	it("searches tools by keyword", () => {
		expect(evalStr(interp, '(search-tools "echo")')).toContain("fx/echo");
	});

	it("unloads a server and removes its bindings", () => {
		expect(evalStr(interp, '(unload-mcp "fx")')).toContain("fx/echo");
		expect(() => run(interp, '(fx/echo :message "hi")')).toThrow(
			/void variable|undefined/,
		);
	});
});
