import { allTabs, emptyLayout } from "@repo/components";
import { describe, expect, it } from "vitest";
import {
	applyPanelOps,
	CHAT_MIN_WIDTH,
	leadChat,
	NEW_CHAT,
	PANEL_DRAG,
	type PanelContent,
	readPanelDrag,
	SIDE_TRACE_MIN_WIDTH,
	STARTING_LAYOUT,
	sideTraceShown,
	startPanelDrag,
	tabMinWidth,
	toPanelOps,
	traceOpen,
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

const chat: PanelContent = { kind: "chat", chatId: "c1", title: "chat" };

describe("chats in the layout", () => {
	it("starts a workspace with nothing saved on one empty chat, the same on every render", () => {
		expect(allTabs(STARTING_LAYOUT)).toEqual([
			{ id: "chat:new:start", content: NEW_CHAT },
		]);
		expect(leadChat(STARTING_LAYOUT)).toBe("chat:new:start");
	});

	it("opens a file beside a focused chat, never over it", () => {
		const layout = applyPanelOps(emptyLayout(), [
			{ op: "open", tab: "chat:c1", split: "here", content: chat },
			{ op: "open", tab: "a", split: "here", content: report },
		]);
		const root = layout.root;
		expect(root?.kind === "split" && root.direction).toBe("row");
		expect(allTabs(layout).map((t) => t.id)).toEqual(["chat:c1", "a"]);
	});

	it("leads with the focused chat, else the first chat on show", () => {
		const layout = applyPanelOps(emptyLayout(), [
			{ op: "open", tab: "chat:c1", split: "here", content: chat },
			{ op: "open", tab: "a", split: "here", content: report },
		]);
		expect(leadChat(layout)).toBe("chat:c1");
		const closed = applyPanelOps(layout, [{ op: "close", tab: "chat:c1" }]);
		expect(leadChat(closed)).toBeUndefined();
	});

	it("keeps the chat a drawn view came from", () => {
		expect(
			toPanelOps([
				{
					op: "open",
					tab: "view:t",
					content: { kind: "view", title: "t", node: null, chatId: "c1" },
				},
			]),
		).toEqual([
			{
				op: "open",
				tab: "view:t",
				split: "here",
				content: { kind: "view", title: "t", node: null, chatId: "c1" },
			},
		]);
	});
});

describe("a chat's trace", () => {
	it("opens to the right of its chat, once, and moves to the turn asked for", () => {
		const chat = applyPanelOps(STARTING_LAYOUT, [
			{
				op: "open",
				tab: "chat:c1",
				split: "here",
				content: { kind: "chat", chatId: "c1", title: "chat" },
			},
		]);
		const traced = applyPanelOps(chat, [traceOpen("c1", "h1")]);
		const again = applyPanelOps(traced, [traceOpen("c1", "h2")]);
		const traces = allTabs(again).filter((t) => t.content.kind === "trace");

		expect(allTabs(traced).map((t) => t.id)).toContain("trace:c1");
		expect(traces).toEqual([
			{
				id: "trace:c1",
				content: { kind: "trace", chatId: "c1", title: "trace", turn: "h2" },
			},
		]);
		expect(again.root?.kind).toBe("split");
	});

	it("survives the wire and a drag as the same tab", () => {
		const [op] = toPanelOps([traceOpen("c1", "h1")]);
		const data = transfer();
		startPanelDrag(data, { kind: "trace", chatId: "c1", title: "trace" });

		expect(op).toEqual(traceOpen("c1", "h1"));
		expect(readPanelDrag(data)).toEqual({
			id: "trace:c1",
			content: { kind: "trace", chatId: "c1", title: "trace" },
		});
	});
});

describe("the trace beside the chat", () => {
	const chat: PanelContent = { kind: "chat", chatId: "c1", title: "chat" };

	it("is collapsed until opened, or open when the preference asks for it", () => {
		expect(sideTraceShown(undefined, false)).toEqual({ shown: "collapsed" });
		expect(sideTraceShown(undefined, true)).toEqual({ shown: "open" });
		expect(sideTraceShown({ shown: "collapsed" }, true)).toEqual({
			shown: "collapsed",
		});
	});

	it("travels with the chat tab, turn included", () => {
		const data = transfer();
		const traced: PanelContent = {
			...chat,
			trace: { shown: "open", turn: "h1" },
		};
		startPanelDrag(data, traced);
		expect(readPanelDrag(data)?.content).toEqual(traced);
	});

	it("drops a trace state it cannot read", () => {
		const data = transfer();
		data.setData(
			PANEL_DRAG,
			JSON.stringify({ ...chat, trace: { shown: "x" } }),
		);
		expect(readPanelDrag(data)?.content).toEqual(chat);
	});

	it("widens the chat tab's floor while open", () => {
		expect(tabMinWidth(chat)).toBe(CHAT_MIN_WIDTH);
		expect(tabMinWidth({ ...chat, trace: { shown: "collapsed" } })).toBe(
			CHAT_MIN_WIDTH,
		);
		expect(tabMinWidth({ ...chat, trace: { shown: "open" } })).toBe(
			CHAT_MIN_WIDTH + SIDE_TRACE_MIN_WIDTH,
		);
	});
});
