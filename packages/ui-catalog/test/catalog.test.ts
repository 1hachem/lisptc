import { describe, expect, it } from "vitest";
import { widgetOf } from "../src/catalog.ts";

describe("the widget catalog", () => {
	it("refuses a tag the object prototype carries", () => {
		expect(widgetOf({ tag: "toString", props: {} })).toBeUndefined();
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
