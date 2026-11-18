// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it } from "vitest";
import { Markdown } from "../src/components/markdown.tsx";

beforeAll(() => {
	Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
});

function links(markdown: string) {
	const host = document.createElement("div");
	act(() => createRoot(host).render(<Markdown>{markdown}</Markdown>));
	return [...host.querySelectorAll("a")].map((a) => ({
		href: a.getAttribute("href"),
		text: a.textContent,
	}));
}

describe("autolink", () => {
	it("keeps explicit links", () => {
		expect(links("[docs](https://example.com)")).toEqual([
			{ href: "https://example.com", text: "docs" },
		]);
	});

	it("links a bare www host over https", () => {
		expect(links("www.example.com")).toEqual([
			{ href: "https://www.example.com", text: "www.example.com" },
		]);
	});

	it("links an angle-bracketed url without its brackets", () => {
		expect(links("go <https://example.com>.")).toEqual([
			{ href: "https://example.com", text: "https://example.com" },
		]);
	});

	it("links an email as mailto", () => {
		expect(links("write to hb@big-mama.io please")).toEqual([
			{ href: "mailto:hb@big-mama.io", text: "hb@big-mama.io" },
		]);
	});

	it("drops trailing sentence punctuation", () => {
		expect(links("go to https://example.com/a.")).toEqual([
			{ href: "https://example.com/a", text: "https://example.com/a" },
		]);
	});

	it("keeps balanced parens and drops the unbalanced one", () => {
		expect(links("(https://example.com/a_(b))")).toEqual([
			{ href: "https://example.com/a_(b)", text: "https://example.com/a_(b)" },
		]);
	});

	it("refuses an unsafe scheme", () => {
		expect(links("<javascript:alert(1)>")).toEqual([]);
	});

	it("does not link inside code or an existing link", () => {
		expect(links("`https://example.com`")).toEqual([]);
		expect(links("[https://a.com](https://b.com)")).toEqual([
			{ href: "https://b.com", text: "https://a.com" },
		]);
	});

	it("links inside emphasis, lists and tables", () => {
		expect(links("*https://example.com*")).toEqual([
			{ href: "https://example.com", text: "https://example.com" },
		]);
		expect(links("- https://example.com")).toEqual([
			{ href: "https://example.com", text: "https://example.com" },
		]);
		expect(links("| a |\n| - |\n| https://example.com |")).toEqual([
			{ href: "https://example.com", text: "https://example.com" },
		]);
	});

	it("leaves a url glued to a word alone", () => {
		expect(links("xhttps://example.com")).toEqual([]);
	});
});
