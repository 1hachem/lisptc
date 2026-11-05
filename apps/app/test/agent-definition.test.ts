import { describe, expect, it } from "vitest";
import { definitionOf } from "../src/lib/agent-definition.ts";

describe("reading a saved sub-agent", () => {
	it("gives its name, instructions, budget, roster and permission rules", () => {
		const definition = definitionOf(
			'(defagent "reader"\n  :prompt "read the docs"\n  :permissions "(permission/deny eval) (permission/ask fs/write)"\n  :roster \'("scout")\n  :budget 40)',
		);
		expect(definition).toMatchObject({
			name: "reader",
			prompt: "read the docs",
			budget: "40",
			roster: ["scout"],
		});
		expect(definition?.rules.map((rule) => rule.source)).toEqual([
			"(permission/deny eval)",
			"(permission/ask fs/write)",
		]);
	});

	it("leaves out what the definition does not set", () => {
		expect(definitionOf('(defagent "bare" :prompt "go")')).toEqual({
			name: "bare",
			prompt: "go",
			budget: undefined,
			roster: undefined,
			rules: [],
		});
	});

	it("gives nothing for text that is not a definition", () => {
		expect(definitionOf("(permission/deny eval)")).toBeUndefined();
		expect(definitionOf("(defagent reader)")).toBeUndefined();
		expect(definitionOf("(defagent")).toBeUndefined();
	});
});
