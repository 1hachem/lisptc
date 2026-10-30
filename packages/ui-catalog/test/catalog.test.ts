import { describe, expect, it } from "vitest";
import {
	ACTION_PROPS,
	ANCHOR_IDS,
	anchorOf,
	anchors,
	isAnchor,
	isPage,
	isTag,
	PAGE_IDS,
	pointer,
	SIDEBAR_FOLDERS,
	TAGS,
	tourLabels,
	tourStep,
	widgetOf,
} from "../src/catalog.ts";

describe("the widget catalog", () => {
	it("names every action prop a widget carries", () => {
		expect([...ACTION_PROPS].sort()).toEqual(["action", "on-change"]);
	});

	it("knows its own tags and nothing else", () => {
		expect(TAGS).toContain("file-link");
		expect(isTag("toString")).toBe(false);
		expect(isTag("carousel")).toBe(false);
	});

	it("reads a node whose props match its tag", () => {
		expect(
			widgetOf({ tag: "badge", props: { text: "open", tone: "ok" } }),
		).toEqual({ tag: "badge", props: { text: "open", tone: "ok" } });
	});

	it("refuses an unknown tag, a missing prop and a stray one", () => {
		expect(widgetOf({ tag: "carousel", props: {} })).toBeUndefined();
		expect(widgetOf({ tag: "link", props: { text: "x" } })).toBeUndefined();
		expect(
			widgetOf({ tag: "text", props: { text: "x", colour: "red" } }),
		).toBeUndefined();
	});

	it("refuses a tone or folder the frontend cannot draw", () => {
		expect(
			widgetOf({ tag: "badge", props: { text: "x", tone: "chartreuse" } }),
		).toBeUndefined();
		expect(
			widgetOf({
				tag: "file-link",
				props: { text: "x", folder: "downloads", name: "x" },
			}),
		).toBeUndefined();
	});
});

describe("the anchor catalog", () => {
	it("knows its own anchors and nothing else", () => {
		expect(ANCHOR_IDS).toEqual(
			expect.arrayContaining(["composer", "knowledge/upload", "account"]),
		);
		expect(isAnchor("toString")).toBe(false);
		expect(isAnchor("model-picker")).toBe(false);
	});

	it("takes a tour step only on a known anchor", () => {
		expect(
			tourStep.safeParse({
				anchor: "knowledge/upload",
				say: "drop a pdf here",
				until: "click",
			}).success,
		).toBe(true);
		expect(tourStep.safeParse({ say: "hello", until: "next" }).success).toBe(
			true,
		);
		expect(
			tourStep.safeParse({ anchor: "nowhere", say: "x", until: "next" })
				.success,
		).toBe(false);
		expect(
			tourStep.safeParse({ anchor: "settings", say: "x", until: "hover" })
				.success,
		).toBe(false);
	});
});

describe("a pointer", () => {
	it("points only at a known anchor and opens only a known page", () => {
		const arrow = {
			anchor: "account",
			mark: "arrow",
			size: "medium",
			click: false,
		};
		expect(pointer.safeParse(arrow).success).toBe(true);
		expect(pointer.safeParse({ ...arrow, mark: "oval" }).success).toBe(true);
		expect(pointer.safeParse({ ...arrow, open: "account" }).success).toBe(true);
		expect(pointer.safeParse({ ...arrow, anchor: "nowhere" }).success).toBe(
			false,
		);
		expect(pointer.safeParse({ ...arrow, open: "billing" }).success).toBe(
			false,
		);
		expect(pointer.safeParse({ ...arrow, mark: "box" }).success).toBe(false);
		expect(pointer.safeParse({ anchor: "account" }).success).toBe(false);
		expect(pointer.safeParse({ ...arrow, size: "huge" }).success).toBe(false);
	});
});

describe("a tour's buttons", () => {
	it("takes a short label for next, done and skip, and nothing else", () => {
		expect(tourLabels.safeParse({ done: "got it" }).success).toBe(true);
		expect(tourLabels.safeParse({ done: "" }).success).toBe(false);
		expect(tourLabels.safeParse({ done: "x".repeat(41) }).success).toBe(false);
		expect(tourLabels.safeParse({ back: "back" }).success).toBe(false);
	});
});

describe("the page catalog", () => {
	it("knows the pages the app opens and nothing else", () => {
		expect(PAGE_IDS).toEqual(["account", "settings", "preferences", "readme"]);
		expect(isPage("toString")).toBe(false);
		expect(isPage("bin")).toBe(false);
	});

	it("takes a tour step only on a known page", () => {
		expect(
			tourStep.safeParse({ page: "settings", say: "x", until: "next" }).success,
		).toBe(true);
		expect(
			tourStep.safeParse({ page: "billing", say: "x", until: "next" }).success,
		).toBe(false);
	});
});

describe("an anchor's location", () => {
	it("is given for every anchor, and names a known folder or page", () => {
		for (const id of ANCHOR_IDS) {
			const { location } = anchors[id];
			if (location.kind === "page") expect(isPage(location.page)).toBe(true);
			if (location.kind === "folder")
				expect(SIDEBAR_FOLDERS).toContain(location.folder);
		}
		expect(anchors["chats/search"].location).toEqual({
			kind: "folder",
			folder: "chat",
		});
		expect(anchors["knowledge/upload"].location).toEqual({ kind: "sidebar" });
	});

	it("is told to the agent in a few words", () => {
		for (const id of ANCHOR_IDS) {
			expect(id).toMatch(/^[a-z][a-z-]*(\/[a-z][a-z-]*)*$/);
			expect(anchors[id].doc.length).toBeGreaterThan(0);
			expect(anchors[id].doc.length).toBeLessThanOrEqual(60);
		}
	});

	it("marks an element with the attribute the app looks it up by", () => {
		expect(anchorOf("composer")).toEqual({ "data-anchor": "composer" });
	});

	it("opens a page of its own name, when it opens one", () => {
		for (const id of ANCHOR_IDS) {
			const { opens } = anchors[id] as { opens?: string };
			if (opens !== undefined) expect(opens).toBe(id);
		}
		expect(PAGE_IDS.every((page) => isAnchor(page))).toBe(true);
	});
});
