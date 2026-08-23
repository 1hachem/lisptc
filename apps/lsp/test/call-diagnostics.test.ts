import { describe, expect, it } from "vitest";
import {
	type CallDoc,
	callDiagnostics,
	diagnosticsForCalls,
	expectedArgs,
} from "../src/call-diagnostics.ts";
import {
	collectCalls,
	parseForms,
	tokenizeWithPositions,
} from "../src/tokenize.ts";

function callsFor(text: string) {
	return collectCalls(parseForms(tokenizeWithPositions(text)));
}

describe("expectedArgs", () => {
	it("renders a fixed arity as a single number", () => {
		expect(expectedArgs({ min: 2, max: 2 })).toBe("2");
	});

	it("renders a range when min and max differ", () => {
		expect(expectedArgs({ min: 1, max: 3 })).toBe("1-3");
	});

	it("renders an unbounded max as 'at least N'", () => {
		expect(expectedArgs({ min: 1 })).toBe("at least 1");
	});
});

describe("diagnosticsForCalls", () => {
	const argsDoc: CallDoc = {
		args: [
			{ name: "name", type: "string", required: true },
			{ name: "url", type: "string", required: false },
		],
	};

	it("flags a keyword-call binding missing a required :arg", () => {
		const calls = callsFor('(load-mcp :url "x")');
		const diagnostics = diagnosticsForCalls(
			calls,
			new Map([["load-mcp", argsDoc]]),
		);
		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0].message).toBe(
			'load-mcp: missing required argument ":name"',
		);
		expect(diagnostics[0].range).toEqual({
			start: { line: 0, character: 1 },
			end: { line: 0, character: 9 },
		});
	});

	it("does not flag a call that supplies every required :arg", () => {
		const calls = callsFor('(load-mcp :name "x" :url "y")');
		expect(
			diagnosticsForCalls(calls, new Map([["load-mcp", argsDoc]])),
		).toEqual([]);
	});

	it("never flags missing optional args", () => {
		const calls = callsFor('(load-mcp :name "x")');
		expect(
			diagnosticsForCalls(calls, new Map([["load-mcp", argsDoc]])),
		).toEqual([]);
	});

	it("flags a positional binding called with too few arguments", () => {
		const calls = callsFor("(car)");
		const diagnostics = diagnosticsForCalls(
			calls,
			new Map([["car", { arity: { min: 1, max: 1 } }]]),
		);
		expect(diagnostics[0].message).toBe("car: expected 1 argument, got 0");
	});

	it("flags a positional binding called with too many arguments", () => {
		const calls = callsFor("(car 1 2)");
		const diagnostics = diagnosticsForCalls(
			calls,
			new Map([["car", { arity: { min: 1, max: 1 } }]]),
		);
		expect(diagnostics[0].message).toBe("car: expected 1 argument, got 2");
	});

	it("does not flag a positional call within its arity range", () => {
		const calls = callsFor("(cons 1 2)");
		expect(
			diagnosticsForCalls(
				calls,
				new Map([["cons", { arity: { min: 2, max: 2 } }]]),
			),
		).toEqual([]);
	});

	it("does not flag an unknown binding (no doc entry at all)", () => {
		const calls = callsFor("(mystery-fn)");
		expect(diagnosticsForCalls(calls, new Map())).toEqual([]);
	});

	// A real MCP tool (args, no arity — unlike load-mcp below) has no valid
	// all-positional call at all, so a bare positional call to one is always
	// wrong, not an alternate valid form to tolerate.
	it("flags a positional call to a keyword-only binding missing a required :arg", () => {
		const calls = callsFor('(fs/read_file "x")');
		const diagnostics = diagnosticsForCalls(
			calls,
			new Map([["fs/read_file", argsDoc]]),
		);
		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0].message).toBe(
			'fs/read_file: missing required argument ":name"',
		);
	});

	// load-mcp accepts either a bare toolkit-name string (no keywords at all)
	// or the :key plist form checked above — a real MCP tool never has a
	// valid all-positional call, so this shape only arises for a hybrid
	// binding like this. Doc shape mirrors what Interp.docs() actually
	// returns for "load-mcp" (args from LOAD_MCP_ARGS, variadic arity).
	describe("a binding with both a keyword-plist and a bare positional form", () => {
		const loadMcpDoc: CallDoc = {
			args: [
				{ name: "name", type: "string", required: true },
				{ name: "url", type: "string", required: false },
			],
			arity: { min: 0 },
		};

		it("does not flag the bare positional form as missing a required :arg", () => {
			const calls = callsFor('(load-mcp "playwright")');
			expect(
				diagnosticsForCalls(calls, new Map([["load-mcp", loadMcpDoc]])),
			).toEqual([]);
		});

		it("still flags a plist call missing a required :arg", () => {
			const calls = callsFor('(load-mcp :url "x")');
			const diagnostics = diagnosticsForCalls(
				calls,
				new Map([["load-mcp", loadMcpDoc]]),
			);
			expect(diagnostics).toHaveLength(1);
			expect(diagnostics[0].message).toBe(
				'load-mcp: missing required argument ":name"',
			);
		});

		it("still flags a call with no arguments at all", () => {
			const calls = callsFor("(load-mcp)");
			const diagnostics = diagnosticsForCalls(
				calls,
				new Map([["load-mcp", loadMcpDoc]]),
			);
			expect(diagnostics).toHaveLength(1);
			expect(diagnostics[0].message).toBe(
				'load-mcp: missing required argument ":name"',
			);
		});
	});
});

describe("callDiagnostics", () => {
	it("resolves each distinct call name exactly once via the injected resolver", async () => {
		const resolved: string[] = [];
		const resolve = async (name: string): Promise<CallDoc> => {
			resolved.push(name);
			return name === "foo"
				? { args: [{ name: "bar", type: "string", required: true }] }
				: {};
		};
		const diagnostics = await callDiagnostics(
			"(foo) (foo :bar 1) (baz)",
			resolve,
		);
		expect(resolved.sort()).toEqual(["baz", "foo"]);
		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0].message).toBe(
			'foo: missing required argument ":bar"',
		);
	});
});
