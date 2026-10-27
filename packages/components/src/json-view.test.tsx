// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { JsonView, parsedJson } from "./json-view.tsx";

beforeAll(() => {
	(
		globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
	).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;

afterEach(async () => {
	await act(async () => root?.unmount());
	root = null;
	document.body.replaceChildren();
});

async function mounted(text: string) {
	const host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
	await act(async () => {
		root?.render(<JsonView text={text} />);
	});
	return host;
}

describe("parsedJson", () => {
	it("parses valid json", () => {
		expect(parsedJson('{"a":[1,null]}')).toEqual({ value: { a: [1, null] } });
	});

	it("reports why invalid json failed", () => {
		expect(parsedJson("{oops")).toHaveProperty("failure");
	});
});

describe("viewing json", () => {
	it("draws an object as a tree of its keys and values", async () => {
		const host = await mounted('{"name":"bloub","ok":true,"n":3}');
		expect(host.querySelector(".react-json-view")).not.toBeNull();
		expect(host.textContent).toContain("name");
		expect(host.textContent).toContain("bloub");
		expect(host.textContent).toContain("true");
	});

	it("shows a top-level scalar as it was written", async () => {
		const host = await mounted('"just text"');
		expect(host.querySelector(".react-json-view")).toBeNull();
		expect(host.querySelector("pre")?.textContent).toBe('"just text"');
	});

	it("falls back to the raw text when the json is invalid", async () => {
		const host = await mounted("{oops");
		expect(host.textContent).toContain("not valid json");
		expect(host.querySelector("pre")?.textContent).toBe("{oops");
	});
});
