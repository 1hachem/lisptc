import { allTabs, emptyLayout } from "@repo/components";
import { describe, expect, it } from "vitest";
import {
	applyPanelOps,
	type PanelContent,
	toPanelOps,
} from "../src/lib/panel-ops.ts";

const report: PanelContent = {
	kind: "file",
	folder: "knowledge",
	name: "q3.pdf",
};

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
		expect(opened.groups).toHaveLength(2);
		const closed = applyPanelOps(opened, [{ op: "close", tab: "a" }]);
		expect(allTabs(closed).map((t) => t.id)).toEqual(["b"]);
	});
});
