import { describe, expect, it } from "vitest";
import {
	type GraphNode,
	graphExtension,
	graphed,
} from "../src/extensions/graph/graph.ts";
import { Interp, prelude, runSync } from "../src/lisp.ts";

function fresh() {
	const interp = new Interp({ extensions: [graphExtension()] });
	const nodes: GraphNode[] = [];
	graphed.on(interp.channels, (node) => nodes.push(node));
	runSync(interp, prelude);
	const step = (code: string) => {
		interp.channels.step += 1;
		runSync(interp, code);
	};
	return { interp, nodes, step };
}

describe("graph extension", () => {
	it("emits nothing while the prelude loads", () => {
		const { nodes } = fresh();
		expect(nodes).toHaveLength(0);
	});

	it("emits one node per top-level form, tagged by step and index", () => {
		const { nodes, step } = fresh();
		step("(setq p 1) (setq q 2)");
		expect(nodes).toHaveLength(2);
		expect(nodes.map((n) => n.id)).toEqual(["1.0", "1.1"]);
		expect(nodes.map((n) => n.index)).toEqual([0, 1]);
		expect(nodes.every((n) => n.step === 1)).toBe(true);
	});

	it("links a later step to the step that defined what it reuses", () => {
		const { nodes, step } = fresh();
		step("(defun helper (x) (+ x 1))");
		step("(helper 3)");
		expect(nodes[0].defines).toEqual(["helper"]);
		expect(nodes[0].reuses).toEqual([]);
		expect(nodes[1].head).toBe("helper");
		expect(nodes[1].ok).toBe(true);
		expect(nodes[1].value).toBe("4");
		expect(nodes[1].reuses).toEqual([{ name: "helper", from: "1.0", step: 1 }]);
	});

	it("tracks every name a multi-pair setq binds", () => {
		const { nodes, step } = fresh();
		step("(setq a 1 b 2)");
		step("(+ a b)");
		expect(nodes[0].defines).toEqual(["a", "b"]);
		expect(nodes[1].reuses.map((r) => r.name).sort()).toEqual(["a", "b"]);
	});

	it("does not read quoted symbols as reuse", () => {
		const { nodes, step } = fresh();
		step("(setq thing 5)");
		step("'thing");
		expect(nodes[1].head).toBe("quote");
		expect(nodes[1].reuses).toEqual([]);
	});

	it("does not read a shadowing parameter as reuse", () => {
		const { nodes, step } = fresh();
		step("(setq x 10)");
		step("((lambda (x) x) 5)");
		step("(+ x 1)");
		expect(nodes[1].reuses).toEqual([]);
		expect(nodes[2].reuses).toEqual([{ name: "x", from: "1.0", step: 1 }]);
	});

	it("marks a failed form and rethrows", () => {
		const { nodes, step } = fresh();
		expect(() => step("(undefined-fn 1)")).toThrow();
		expect(nodes).toHaveLength(1);
		expect(nodes[0].ok).toBe(false);
		expect(nodes[0].error).toBeTruthy();
	});

	it("does not record a definition from a form that failed", () => {
		const { nodes, step } = fresh();
		expect(() => step("(setq shared (undefined-fn))")).toThrow();
		expect(() => step("shared")).toThrow();
		expect(nodes[1].reuses).toEqual([]);
	});
});
