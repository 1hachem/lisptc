import { describe, expect, it } from "vitest";
import {
	ACTION_PROPS,
	ANCHOR_IDS,
	isAnchor,
	isPage,
	isTag,
	PAGE_IDS,
	TAGS,
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
		expect(ANCHOR_IDS).toEqual(["composer", "knowledge/upload", "settings"]);
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
