import { describe, expect, it } from "vitest";
import { argCompletionItems } from "../src/doc-args.ts";

describe("argCompletionItems", () => {
	const items = argCompletionItems([
		{ name: "url", type: "string", required: true, description: "the URL" },
		{ name: "headers", type: "alist", required: false },
	]);

	it("renders each arg as a `:key` label", () => {
		expect(items.map((i) => i.label)).toEqual([":url", ":headers"]);
	});

	it("marks required args in the detail text, and leaves optional ones bare", () => {
		expect(items[0].detail).toBe("string (required)");
		expect(items[1].detail).toBe("alist");
	});

	it("carries the description through as markdown documentation", () => {
		expect(items[0].documentation).toEqual({
			kind: "markdown",
			value: "the URL",
		});
	});

	it("omits documentation when there is no description", () => {
		expect(items[1].documentation).toBeUndefined();
	});

	it("sorts required args before optional ones via sortText", () => {
		expect(items[0].sortText).toBe("0url");
		expect(items[1].sortText).toBe("1headers");
	});
});
