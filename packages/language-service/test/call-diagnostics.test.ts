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
		const diagnostics = callDiagnostics(
			'(load-mcp :url "x")',
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
		expect(
			callDiagnostics(
				'(load-mcp :name "x" :url "y")',
				new Map([["load-mcp", argsDoc]]),
			),
		).toEqual([]);
	});

	it("never flags missing optional args", () => {
		const calls = callsFor('(load-mcp :name "x")');
		expect(
			diagnosticsForCalls(calls, new Map([["load-mcp", argsDoc]])),
		).toEqual([]);
	});

	it("flags a positional binding called with too few arguments", () => {
		const diagnostics = callDiagnostics(
			"(car)",
			new Map([["car", { arity: { min: 1, max: 1 } }]]),
		);
		expect(diagnostics[0].message).toBe("car: expected 1 argument, got 0");
	});

	it("flags a positional binding called with too many arguments", () => {
		const diagnostics = callDiagnostics(
			"(car 1 2)",
			new Map([["car", { arity: { min: 1, max: 1 } }]]),
		);
		expect(diagnostics[0].message).toBe("car: expected 1 argument, got 2");
	});

	it("does not flag a positional call within its arity range", () => {
		expect(
			callDiagnostics(
				"(cons 1 2)",
				new Map([["cons", { arity: { min: 2, max: 2 } }]]),
			),
		).toEqual([]);
	});

	it("does not flag an unknown binding (no doc entry at all)", () => {
		expect(callDiagnostics("(mystery-fn)", new Map())).toEqual([]);
	});

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

	describe("a binding with both a keyword-plist and a bare positional form", () => {
		const loadMcpDoc: CallDoc = {
			args: [
				{ name: "name", type: "string", required: true },
				{ name: "url", type: "string", required: false },
			],
			arity: { min: 0 },
		};

		it("does not flag the bare positional form as missing a required :arg", () => {
			expect(
				callDiagnostics(
					'(load-mcp "playwright")',
					new Map([["load-mcp", loadMcpDoc]]),
				),
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

		it("checks a bare positional call against its arity first", () => {
			const calls = callsFor("(pick)");
			const diagnostics = diagnosticsForCalls(
				calls,
				new Map([
					[
						"pick",
						{
							args: [{ name: "server", type: "string", required: true }],
							arity: { min: 1, max: 1 },
						},
					],
				]),
			);
			expect(diagnostics.map((d) => d.message)).toEqual([
				"pick: expected 1 argument, got 0",
			]);
		});

		it("accepts a bare call that leaves an optional positional arg out", () => {
			expect(
				callDiagnostics(
					"(pick)",
					new Map([
						[
							"pick",
							{
								args: [{ name: "server", type: "string", required: false }],
								arity: { min: 0 },
							},
						],
					]),
				),
			).toEqual([]);
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
	it("checks every call in the text against the docs it is given", () => {
		const diagnostics = callDiagnostics(
			"(foo) (foo :bar 1) (baz)",
			new Map([
				["foo", { args: [{ name: "bar", type: "string", required: true }] }],
			]),
		);
		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0].message).toBe(
			'foo: missing required argument ":bar"',
		);
	});
});

describe("word caps", () => {
	const capped: CallDoc = { wordCaps: [{ position: 1, words: 3 }] };
	const table = new Map([["memory", capped]]);

	it("flags a positional string past its cap, over the string itself", () => {
		const diagnostics = callDiagnostics(
			'(memory "k" :when "a b c d e"\n  "one two\nthree four")',
			table,
		);
		expect(diagnostics.map((d) => d.message)).toEqual([
			"memory: holds at most 3 words here, this one has 4",
		]);
		expect(diagnostics[0].range).toEqual({
			start: { line: 1, character: 2 },
			end: { line: 2, character: 11 },
		});
	});

	it("leaves a string within its cap, and a keyword's value, alone", () => {
		expect(
			callDiagnostics('(memory "k" :when "a b c d e" "one two")', table),
		).toEqual([]);
	});
});
