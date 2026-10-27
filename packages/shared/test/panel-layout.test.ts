import { describe, expect, it } from "vitest";
import { applyPanelOps, focusedTab } from "../src/panel-layout.ts";
import { allTabs, emptyLayout } from "../src/split-layout.ts";

type Content = { kind: "chat" } | { kind: "file"; name: string };

const chat: Content = { kind: "chat" };
const file: Content = { kind: "file", name: "a.md" };

describe("applying panel ops", () => {
	it("opens a tab beside a focused chat rather than over it", () => {
		const layout = applyPanelOps(emptyLayout<Content>(), [
			{ op: "open", tab: "chat", split: "here", content: chat },
			{ op: "open", tab: "file", split: "here", content: file },
		]);
		expect(layout.root?.kind === "split" && layout.root.direction).toBe("row");
		expect(focusedTab(layout)?.id).toBe("file");
	});

	it("stacks a tab in the focused split when no chat holds it", () => {
		const layout = applyPanelOps(emptyLayout<Content>(), [
			{ op: "open", tab: "file", split: "here", content: file },
			{ op: "open", tab: "other", split: "here", content: file },
		]);
		expect(layout.root?.kind).toBe("pane");
	});

	it("opens below when asked, focuses and closes by tab id", () => {
		const opened = applyPanelOps(emptyLayout<Content>(), [
			{ op: "open", tab: "a", split: "here", content: file },
			{ op: "open", tab: "b", split: "down", content: file },
			{ op: "focus", tab: "a" },
		]);
		expect(opened.root?.kind === "split" && opened.root.direction).toBe(
			"column",
		);
		expect(focusedTab(opened)?.id).toBe("a");
		const closed = applyPanelOps(opened, [{ op: "close", tab: "a" }]);
		expect(allTabs(closed).map((t) => t.id)).toEqual(["b"]);
	});
});
