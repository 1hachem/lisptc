import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { run } from "../src/lisp.ts";
import { ev, freshInterp } from "./helpers.ts";

const FIXTURE = fileURLToPath(
	new URL("./fixture-mcp-server.ts", import.meta.url),
);

describe("self-evaluating keywords", () => {
	const interp = freshInterp();

	it("evaluates :keywords to themselves and prints with a colon", () => {
		expect(ev("(list :query 1 :limit 2)", interp)).toBe("(:query 1 :limit 2)");
	});

	it("interns keywords so eq holds", () => {
		expect(ev("(eq :a :a)", interp)).toBe("t");
	});

	it("does not break existing symbol evaluation", () => {
		expect(ev("(+ 1 2 3)", interp)).toBe("6");
	});
});

describe("MCP integration (stdio fixture)", () => {
	const interp = freshInterp();

	afterAll(() => {
		run(interp, "(mcp-shutdown)");
	});

	it("loads a stdio server and expands its tools into bindings", () => {
		const out = ev(
			`(load-mcp :name "fx" :command "node" :args (quote ("--experimental-transform-types" "${FIXTURE}")))`,
			interp,
		);
		expect(out).toContain("fx/echo");
	});

	it("lists loaded servers", () => {
		expect(ev("(list-mcps)", interp)).toContain("fx");
		expect(ev("(list-mcps)", interp)).toContain(":loaded");
	});

	it("calls a tool with native keyword syntax", () => {
		expect(ev('(fx/echo :message "hi")', interp)).toBe('"hi"');
	});

	it("validates required arguments before calling", () => {
		expect(() => run(interp, "(fx/echo)")).toThrow(
			/required argument "message"/,
		);
	});

	it("renders documentation", () => {
		const doc = ev("(mcp-doc 'fx/echo)", interp);
		expect(doc).toContain("Echo back the given message");
		expect(doc).toContain("message");
	});

	it("searches tools by keyword", () => {
		expect(ev('(search-tools "echo")', interp)).toContain("fx/echo");
	});

	it("unloads a server and removes its bindings", () => {
		expect(ev('(unload-mcp "fx")', interp)).toContain("fx/echo");
		expect(() => run(interp, '(fx/echo :message "hi")')).toThrow(
			/void variable|undefined/,
		);
	});
});

describe("async MCP calls (:async / await / poll)", () => {
	const interp = freshInterp();

	afterAll(() => {
		run(interp, "(mcp-shutdown)");
	});

	it("loads the fixture server", () => {
		const out = ev(
			`(load-mcp :name "ax" :command "node" :args (quote ("--experimental-transform-types" "${FIXTURE}")))`,
			interp,
		);
		expect(out).toContain("ax/slow-echo");
	});

	it(":async t returns a future immediately, resolved by await", () => {
		const out = ev(
			`(setq f (ax/slow-echo :message "later" :ms 50 :async t))
			 (await f)`,
			interp,
		);
		expect(out).toBe('"later"');
	});

	it("prints futures opaquely and reports status via poll", () => {
		expect(
			ev('(setq f (ax/slow-echo :message "x" :ms 200 :async t))', interp),
		).toContain("#<mcp-future:ax/slow-echo:");
		expect(ev("(poll f)", interp)).toBe(":pending");
		expect(ev("(await f)", interp)).toBe('"x"');
		expect(ev("(poll f)", interp)).toBe(":done");
		// A second await returns the memoized result.
		expect(ev("(await f)", interp)).toBe('"x"');
	});

	it("runs concurrent calls in ~max, not ~sum, wall time", () => {
		const start = Date.now();
		const out = ev(
			`(await-all (list (ax/slow-echo :message "a" :ms 300 :async t)
			                  (ax/slow-echo :message "b" :ms 300 :async t)
			                  (ax/slow-echo :message "c" :ms 300 :async t)))`,
			interp,
		);
		const elapsed = Date.now() - start;
		expect(out).toBe('("a" "b" "c")');
		// Serial execution would take >= 900ms; allow generous slack for CI.
		expect(elapsed).toBeLessThan(750);
	});

	it("surfaces tool errors through await", () => {
		run(interp, '(setq bad (ax/fail :message "boom" :async t))');
		expect(() => run(interp, "(await bad)")).toThrow(/MCP error: boom/);
		expect(ev("(poll bad)", interp)).toBe(":error");
	});

	it("validates arguments synchronously even for :async calls", () => {
		expect(() => run(interp, "(ax/echo :async t)")).toThrow(
			/required argument "message"/,
		);
	});

	it("rejects await on a non-future", () => {
		expect(() => run(interp, "(await 42)")).toThrow(/mcp future expected/);
	});
});
