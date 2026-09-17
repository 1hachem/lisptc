import { describe, expect, it } from "vitest";
import { collectGraph, type GraphNode } from "../src/lib/graph.ts";

function toolMessage(graph: unknown) {
	return { type: "tool", additional_kwargs: { graph } };
}

const nodeA = {
	id: "1.0",
	step: 1,
	index: 0,
	head: "defun",
	source: "(defun helper (x) (+ x 1))",
	ok: true,
	value: "helper",
	defines: ["helper"],
	reuses: [],
};

const nodeB = {
	id: "2.0",
	step: 2,
	index: 0,
	head: "helper",
	source: "(helper 3)",
	ok: true,
	value: "4",
	defines: [],
	reuses: [{ name: "helper", from: "1.0", step: 1 }],
};

describe("collectGraph", () => {
	it("flattens tool-message graph payloads sorted by step and index", () => {
		const nodes = collectGraph([
			{ type: "human" },
			toolMessage([nodeB]),
			toolMessage([nodeA]),
		]);
		expect(nodes.map((n) => n.id)).toEqual(["1.0", "2.0"]);
		expect(nodes[1].reuses).toEqual([{ name: "helper", from: "1.0", step: 1 }]);
	});

	it("dedupes nodes that repeat across re-renders", () => {
		const nodes = collectGraph([toolMessage([nodeA]), toolMessage([nodeA])]);
		expect(nodes).toHaveLength(1);
	});

	it("ignores non-tool messages and malformed payloads", () => {
		expect(collectGraph([{ type: "ai" }])).toEqual([]);
		expect(collectGraph([toolMessage("not-an-array")])).toEqual([]);
		expect(collectGraph([toolMessage([{ nonsense: true }])])).toEqual([]);
	});

	it("keeps a failed node with its error", () => {
		const failed = {
			id: "1.0",
			step: 1,
			index: 0,
			head: null,
			source: "(undefined-fn 1)",
			ok: false,
			error: "unbound variable",
			defines: [],
			reuses: [],
		};
		const nodes: GraphNode[] = collectGraph([toolMessage([failed])]);
		expect(nodes[0].ok).toBe(false);
		expect(nodes[0].error).toBe("unbound variable");
	});
});
