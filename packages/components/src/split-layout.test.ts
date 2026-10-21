import { describe, expect, it } from "vitest";
import {
	allTabs,
	closeTab,
	dropTab,
	emptyLayout,
	flip,
	joinPane,
	MAX_SPLITS,
	moveTab,
	openTab,
	paneOf,
	type SplitLayout,
	type Tab,
} from "./split-layout.ts";

const tab = (id: string): Tab<string> => ({ id, content: id });

function shape(layout: SplitLayout<string>): string[][][] {
	return layout.groups.map((g) => g.panes.map((p) => p.tabs.map((t) => t.id)));
}

function opened(...ids: string[]): SplitLayout<string> {
	return ids.reduce((l, id) => openTab(l, tab(id)), emptyLayout<string>());
}

describe("opening tabs", () => {
	it("seeds one group with one pane from an empty layout", () => {
		const layout = opened("a");
		expect(shape(layout)).toEqual([[["a"]]]);
		expect(layout.focused).toBe(layout.groups[0].panes[0].id);
	});

	it("adds to the focused pane and makes the new tab active", () => {
		const layout = opened("a", "b");
		expect(shape(layout)).toEqual([[["a", "b"]]]);
		expect(layout.groups[0].panes[0].active).toBe("b");
	});

	it("focuses an already open tab instead of opening it twice", () => {
		const layout = openTab(opened("a", "b"), tab("a"));
		expect(shape(layout)).toEqual([[["a", "b"]]]);
		expect(layout.groups[0].panes[0].active).toBe("a");
	});

	it("splits right across groups and down within a group when the root is a row", () => {
		const right = openTab(opened("a"), tab("b"), "right");
		expect(shape(right)).toEqual([[["a"]], [["b"]]]);
		const down = openTab(right, tab("c"), "down");
		expect(shape(down)).toEqual([[["a"]], [["b"], ["c"]]]);
	});

	it("swaps the axes when the root is a column", () => {
		const layout = openTab(flip(opened("a")), tab("b"), "right");
		expect(shape(layout)).toEqual([[["a"], ["b"]]]);
	});

	it(`stops at ${MAX_SPLITS} splits each way and opens in the focused pane instead`, () => {
		let layout = opened("a");
		for (const id of ["b", "c", "d"])
			layout = openTab(layout, tab(id), "right");
		expect(layout.groups).toHaveLength(MAX_SPLITS);
		expect(shape(layout)).toEqual([[["a"]], [["b"]], [["c", "d"]]]);
		for (const id of ["e", "f", "g"]) layout = openTab(layout, tab(id), "down");
		expect(layout.groups[2].panes).toHaveLength(MAX_SPLITS);
	});

	it("keeps sizes summing to a whole", () => {
		const layout = openTab(
			openTab(opened("a"), tab("b"), "right"),
			tab("c"),
			"right",
		);
		const total = layout.groups.reduce((sum, g) => sum + g.size, 0);
		expect(total).toBeCloseTo(100);
	});
});

describe("closing and joining", () => {
	it("collapses a pane emptied by closing its last tab", () => {
		const layout = closeTab(openTab(opened("a"), tab("b"), "right"), "b");
		expect(shape(layout)).toEqual([[["a"]]]);
		expect(layout.groups[0].size).toBe(100);
	});

	it("activates the neighbour of a closed active tab", () => {
		const layout = closeTab(focus(opened("a", "b", "c"), "b"), "b");
		expect(layout.groups[0].panes[0].active).toBe("c");
	});

	it("ends empty when the last tab closes", () => {
		const layout = closeTab(opened("a"), "a");
		expect(allTabs(layout)).toEqual([]);
		expect(layout.focused).toBeNull();
	});

	it("joins a pane into its neighbour", () => {
		const split = openTab(opened("a"), tab("b"), "right");
		const joined = joinPane(split, paneOf(split, "b")?.id as string);
		expect(shape(joined)).toEqual([[["a", "b"]]]);
	});
});

describe("moving tabs", () => {
	it("moves a tab into another pane", () => {
		const split = openTab(opened("a", "b"), tab("c"), "right");
		const moved = moveTab(split, "b", {
			pane: paneOf(split, "c")?.id as string,
			index: 0,
		});
		expect(shape(moved)).toEqual([[["a"]], [["b", "c"]]]);
	});

	it("splits a pane when a tab lands on its edge", () => {
		const layout = opened("a", "b");
		const pane = layout.groups[0].panes[0].id;
		expect(shape(moveTab(layout, "b", { pane, edge: "bottom" }))).toEqual([
			[["a"], ["b"]],
		]);
		expect(shape(moveTab(layout, "b", { pane, edge: "left" }))).toEqual([
			[["b"]],
			[["a"]],
		]);
	});

	it("leaves a lone tab dropped on its own pane's edge alone", () => {
		const layout = opened("a");
		const pane = layout.groups[0].panes[0].id;
		expect(moveTab(layout, "a", { pane, edge: "right" })).toBe(layout);
	});

	it("frees the source split before counting toward the limit", () => {
		let layout = opened("a");
		for (const id of ["b", "c"]) layout = openTab(layout, tab(id), "right");
		const moved = moveTab(layout, "c", {
			pane: paneOf(layout, "a")?.id as string,
			edge: "left",
		});
		expect(shape(moved)).toEqual([[["c"]], [["a"]], [["b"]]]);
	});
});

function focus(layout: SplitLayout<string>, id: string) {
	return openTab(layout, tab(id));
}

describe("dropping something from outside", () => {
	it("adds it as a tab where it lands", () => {
		const layout = opened("a", "b");
		const pane = layout.groups[0].panes[0].id;
		const dropped = dropTab(layout, tab("c"), { pane, index: 1 });
		expect(shape(dropped)).toEqual([[["a", "c", "b"]]]);
		expect(dropped.groups[0].panes[0].active).toBe("c");
	});

	it("splits the pane when it lands on an edge", () => {
		const layout = opened("a");
		const pane = layout.groups[0].panes[0].id;
		expect(shape(dropTab(layout, tab("c"), { pane, edge: "bottom" }))).toEqual([
			[["a"], ["c"]],
		]);
	});

	it("moves it when it is already open somewhere else", () => {
		const split = openTab(opened("a"), tab("b"), "right");
		const left = paneOf(split, "a")?.id as string;
		expect(shape(dropTab(split, tab("b"), { pane: left }))).toEqual([
			[["a", "b"]],
		]);
	});

	it("opens it in the focused pane when the target is gone", () => {
		expect(shape(dropTab(opened("a"), tab("c"), { pane: "nowhere" }))).toEqual([
			[["a", "c"]],
		]);
	});
});
