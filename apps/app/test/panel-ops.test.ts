import { allTabs, emptyLayout } from "@repo/components";
import { describe, expect, it } from "vitest";
import {
	applyPanelOps,
	PANEL_DRAG,
	type PanelContent,
	readPanelDrag,
	startPanelDrag,
	toPanelOps,
	withMain,
} from "../src/lib/panel-ops.ts";

const report: PanelContent = {
	kind: "file",
	folder: "knowledge",
	name: "q3.pdf",
};

function transfer(): DataTransfer {
	const held = new Map<string, string>();
	return {
		effectAllowed: "none",
		setData: (key: string, value: string) => held.set(key, value),
		getData: (key: string) => held.get(key) ?? "",
	} as unknown as DataTransfer;
}

describe("dragging a file into the panel", () => {
	it("carries the file across as the tab it opens", () => {
		const data = transfer();
		startPanelDrag(data, report);
		expect(readPanelDrag(data)).toEqual({
			id: "file:knowledge/q3.pdf",
			content: report,
		});
	});

	it("reads nothing from a drag that carries something else", () => {
		const data = transfer();
		data.setData(PANEL_DRAG, "{not json");
		expect(readPanelDrag(data)).toBeUndefined();
		expect(readPanelDrag(transfer())).toBeUndefined();
	});
});

describe("the panel lane off the wire", () => {
	it("keeps the ops it can place and drops the rest", () => {
		expect(
			toPanelOps([
				{
					op: "open",
					tab: "file:knowledge/q3.pdf",
					split: "right",
					content: report,
				},
				{
					op: "open",
					tab: "x",
					content: { kind: "file", folder: "bin", name: "x" },
				},
				{ op: "close", tab: "file:knowledge/q3.pdf" },
				{ op: "explode", tab: "x" },
				"nonsense",
			]),
		).toEqual([
			{
				op: "open",
				tab: "file:knowledge/q3.pdf",
				split: "right",
				content: report,
			},
			{ op: "close", tab: "file:knowledge/q3.pdf" },
		]);
	});

	it("reads nothing from a lane that is not a list", () => {
		expect(toPanelOps(undefined)).toEqual([]);
		expect(toPanelOps({ op: "open" })).toEqual([]);
	});

	it("opens to the side the step asked for and closes by tab id", () => {
		const opened = applyPanelOps(emptyLayout(), [
			{ op: "open", tab: "a", split: "here", content: report },
			{
				op: "open",
				tab: "b",
				split: "right",
				content: { kind: "view", title: "b", node: null },
			},
		]);
		expect(opened.root?.kind).toBe("split");
		const closed = applyPanelOps(opened, [{ op: "close", tab: "a" }]);
		expect(allTabs(closed).map((t) => t.id)).toEqual(["b"]);
	});
});

describe("the chat pinned in the layout", () => {
	it("is always there, and cannot be closed", () => {
		const layout = withMain(emptyLayout());
		expect(allTabs(layout).map((t) => t.id)).toEqual(["main"]);
		expect(applyPanelOps(layout, [{ op: "close", tab: "main" }])).toEqual(
			layout,
		);
	});

	it("goes back to the left of a layout that lost it", () => {
		const others = applyPanelOps(emptyLayout(), [
			{ op: "open", tab: "a", split: "here", content: report },
		]);
		const layout = withMain(others);
		expect(allTabs(layout).map((t) => t.id)).toEqual(["main", "a"]);
		expect(layout.root?.kind).toBe("split");
	});

	it("opens a file beside the chat, never over it", () => {
		const layout = applyPanelOps(withMain(emptyLayout()), [
			{ op: "open", tab: "a", split: "here", content: report },
		]);
		const root = layout.root;
		expect(root?.kind === "split" && root.direction).toBe("row");
		expect(allTabs(layout).map((t) => t.id)).toEqual(["main", "a"]);
	});
});
