import { parseMarkdown } from "@tanstack/markdown/parser";
import { describe, expect, it } from "vitest";
import { autolinkExtension } from "../src/components/autolink.ts";

function links(markdown: string) {
	const found: { href: string; text: string }[] = [];
	const walk = (nodes: unknown[]) => {
		for (const node of nodes as Record<string, unknown>[]) {
			if (node.type === "link")
				found.push({
					href: node.href as string,
					text: (node.children as { value: string }[])
						.map((child) => child.value)
						.join(""),
				});
			else if (Array.isArray(node.children)) walk(node.children);
			else if (Array.isArray(node.items)) walk(node.items);
			else if (node.type === "table")
				walk([
					...(node.header as unknown[]),
					...(node.rows as unknown[][]).flat(),
				]);
		}
	};
	walk(parseMarkdown(markdown, { extensions: [autolinkExtension()] }).children);
	return found;
}

function text(markdown: string) {
	const document = parseMarkdown(markdown, {
		extensions: [autolinkExtension()],
	});
	return JSON.stringify(document.children);
}

describe("autolink", () => {
	it("keeps explicit links", () => {
		expect(links("[docs](https://example.com)")).toEqual([
			{ href: "https://example.com", text: "docs" },
		]);
	});

	it("links a bare url", () => {
		expect(links("see https://example.com/a?b=1 now")).toEqual([
			{ href: "https://example.com/a?b=1", text: "https://example.com/a?b=1" },
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
		expect(text("go <https://example.com>.")).toContain('"go "');
		expect(text("go <https://example.com>.")).toContain('"."');
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
		expect(text("go to https://example.com/a.")).toContain('"."');
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
