import { describe, expect, it } from "vitest";
import {
	allTabs,
	closePane,
	closeTab,
	dropTab,
	emptyLayout,
	flatten,
	flip,
	joinPane,
	MAX_SPLITS,
	moveTab,
	type Node,
	openTab,
	paneOf,
	replaceTab,
	type SplitLayout,
	type Tab,
	unflatten,
	vacantPane,
} from "./split-layout.ts";

const tab = (id: string): Tab<string> => ({ id, content: id });

type Shape = string[] | { row: Shape[] } | { column: Shape[] };

function shapeOf(node: Node<string> | null): Shape | null {
	if (node === null) return null;
	if (node.kind === "pane") return node.tabs.map((t) => t.id);
	const children = node.children.map((c) => shapeOf(c) as Shape);
	return node.direction === "row" ? { row: children } : { column: children };
}

const shape = (layout: SplitLayout<string>) => shapeOf(layout.root);

function opened(...ids: string[]): SplitLayout<string> {
	return ids.reduce((l, id) => openTab(l, tab(id)), emptyLayout<string>());
}

const pane = (layout: SplitLayout<string>, id: string) =>
	paneOf(layout, id)?.id as string;

describe("opening tabs", () => {
	it("seeds one pane from an empty layout", () => {
		const layout = opened("a");
		expect(shape(layout)).toEqual(["a"]);
		expect(layout.focused).toBe(pane(layout, "a"));
	});

	it("adds to the focused pane and makes the new tab active", () => {
		const layout = opened("a", "b");
		expect(shape(layout)).toEqual(["a", "b"]);
		expect(paneOf(layout, "b")?.active).toBe("b");
	});

	it("focuses an already open tab instead of opening it twice", () => {
		const layout = openTab(opened("a", "b"), tab("a"));
		expect(shape(layout)).toEqual(["a", "b"]);
		expect(paneOf(layout, "a")?.active).toBe("a");
	});

	it("splits right and then down beside the focused pane", () => {
		const right = openTab(opened("a"), tab("b"), "right");
		expect(shape(right)).toEqual({ row: [["a"], ["b"]] });
		const down = openTab(right, tab("c"), "down");
		expect(shape(down)).toEqual({ row: [["a"], { column: [["b"], ["c"]] }] });
	});

	it(`stops at ${MAX_SPLITS} side by side and opens in the focused pane instead`, () => {
		let layout = opened("a");
		for (const id of ["b", "c", "d"])
			layout = openTab(layout, tab(id), "right");
		expect(shape(layout)).toEqual({ row: [["a"], ["b"], ["c", "d"]] });
	});

	it("keeps sizes summing to a whole", () => {
		const layout = openTab(
			openTab(opened("a"), tab("b"), "right"),
			tab("c"),
			"right",
		);
		const root = layout.root;
		expect(root?.kind).toBe("split");
		if (root?.kind === "split")
			expect(root.sizes.reduce((a, b) => a + b)).toBeCloseTo(100);
	});
});

describe("splitting the whole view, not just one pane", () => {
	const twoChats = () => openTab(opened("chat"), tab("other"), "right");

	it("puts a file under one chat when it lands on that chat's bottom edge", () => {
		const layout = twoChats();
		const dropped = dropTab(layout, tab("file"), {
			pane: pane(layout, "chat"),
			edge: "bottom",
		});
		expect(shape(dropped)).toEqual({
			row: [{ column: [["chat"], ["file"]] }, ["other"]],
		});
	});

	it("puts a file under both chats when it lands on the view's bottom edge", () => {
		const layout = twoChats();
		const dropped = dropTab(layout, tab("file"), {
			node: layout.root?.id as string,
			edge: "bottom",
		});
		expect(shape(dropped)).toEqual({
			column: [{ row: [["chat"], ["other"]] }, ["file"]],
		});
	});

	it("joins the view's own split when it lands on an edge along it", () => {
		const layout = twoChats();
		const dropped = dropTab(layout, tab("file"), {
			node: layout.root?.id as string,
			edge: "right",
		});
		expect(shape(dropped)).toEqual({ row: [["chat"], ["other"], ["file"]] });
	});
});

describe("closing and joining", () => {
	it("keeps a pane emptied by closing its last tab, to drop into", () => {
		const layout = closeTab(openTab(opened("a"), tab("b"), "right"), "b");
		expect(shape(layout)).toEqual({ row: [["a"], []] });
		const vacant = vacantPane(layout) as string;
		expect(shape(dropTab(layout, tab("c"), { pane: vacant }))).toEqual({
			row: [["a"], ["c"]],
		});
	});

	it("keeps an empty pane across a save and a load", () => {
		const layout = closeTab(openTab(opened("a"), tab("b"), "right"), "b");
		expect(unflatten(flatten(layout))).toEqual(layout);
	});

	it("closes an empty pane through its menu", () => {
		const layout = closeTab(openTab(opened("a"), tab("b"), "right"), "b");
		expect(shape(closePane(layout, vacantPane(layout) as string))).toEqual([
			"a",
		]);
	});

	it("collapses the pane a tab is dragged out of", () => {
		const split = openTab(opened("a"), tab("b"), "right");
		const moved = moveTab(split, "b", { pane: pane(split, "a") });
		expect(shape(moved)).toEqual(["a", "b"]);
	});

	it("never closes a fixed tab", () => {
		const layout = openTab(emptyLayout<string>(), {
			...tab("main"),
			fixed: true,
		});
		expect(closeTab(layout, "main")).toBe(layout);
	});

	it("activates the neighbour of a closed active tab", () => {
		const layout = closeTab(openTab(opened("a", "b", "c"), tab("b")), "b");
		expect(paneOf(layout, "c")?.active).toBe("c");
	});

	it("ends empty when the last tab closes", () => {
		const layout = closeTab(
			closeTab(openTab(opened("a"), tab("b"), "right"), "b"),
			"a",
		);
		expect(layout.root).toBeNull();
		expect(allTabs(layout)).toEqual([]);
		expect(layout.focused).toBeNull();
	});

	it("joins a pane into its neighbour", () => {
		const split = openTab(opened("a"), tab("b"), "right");
		expect(shape(joinPane(split, pane(split, "b")))).toEqual(["a", "b"]);
	});

	it("flips the split a pane sits in", () => {
		const split = openTab(opened("a"), tab("b"), "right");
		expect(shape(flip(split, pane(split, "a")))).toEqual({
			column: [["a"], ["b"]],
		});
	});
});

describe("moving tabs", () => {
	it("moves a tab into another pane", () => {
		const split = openTab(opened("a", "b"), tab("c"), "right");
		const moved = moveTab(split, "b", { pane: pane(split, "c"), index: 0 });
		expect(shape(moved)).toEqual({ row: [["a"], ["b", "c"]] });
	});

	it("splits a pane when a tab lands on its edge", () => {
		const layout = opened("a", "b");
		const at = pane(layout, "a");
		expect(shape(moveTab(layout, "b", { pane: at, edge: "bottom" }))).toEqual({
			column: [["a"], ["b"]],
		});
		expect(shape(moveTab(layout, "b", { pane: at, edge: "left" }))).toEqual({
			row: [["b"], ["a"]],
		});
	});

	it("leaves a lone tab dropped on its own pane's edge alone", () => {
		const layout = opened("a");
		expect(
			moveTab(layout, "a", { pane: pane(layout, "a"), edge: "right" }),
		).toBe(layout);
	});

	it("moves a tab out from under one chat to under both", () => {
		const twoChats = openTab(opened("chat"), tab("other"), "right");
		const under = dropTab(twoChats, tab("file"), {
			pane: pane(twoChats, "chat"),
			edge: "bottom",
		});
		const moved = moveTab(under, "file", {
			node: under.root?.id as string,
			edge: "bottom",
		});
		expect(shape(moved)).toEqual({
			column: [{ row: [["chat"], ["other"]] }, ["file"]],
		});
	});
});

describe("replacing what a tab shows", () => {
	it("keeps the tab where it is under its new id", () => {
		expect(shape(replaceTab(opened("a", "b"), "a", tab("c")))).toEqual([
			"c",
			"b",
		]);
	});

	it("folds into a tab already showing the new content", () => {
		const split = openTab(opened("a"), tab("b"), "right");
		expect(shape(replaceTab(split, "a", tab("b")))).toEqual(["b"]);
	});
});

describe("dropping something from outside", () => {
	it("adds it as a tab where it lands", () => {
		const layout = opened("a", "b");
		const dropped = dropTab(layout, tab("c"), {
			pane: pane(layout, "a"),
			index: 1,
		});
		expect(shape(dropped)).toEqual(["a", "c", "b"]);
	});

	it("opens it in the focused pane when the target is gone", () => {
		expect(shape(dropTab(opened("a"), tab("c"), { pane: "nowhere" }))).toEqual([
			"a",
			"c",
		]);
	});
});

describe("storing a layout flat", () => {
	it("comes back the same tree it was", () => {
		const layout = openTab(
			openTab(opened("a"), tab("b"), "right"),
			tab("c"),
			"down",
		);
		expect(unflatten(flatten(layout))).toEqual(layout);
	});

	it("drops a node that points at itself rather than looping", () => {
		const looped = unflatten({
			root: "s1",
			focused: null,
			nodes: [
				{
					kind: "split",
					id: "s1",
					direction: "row",
					children: ["s1", "p1"],
					sizes: [50, 50],
				},
				{ kind: "pane", id: "p1", tabs: [tab("a")], active: "a" },
			],
		});
		expect(shape(looped)).toEqual(["a"]);
	});
});
