// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { sidewaysLeaks } from "./helpers.ts";

const LONG = "z".repeat(120);

function tree(html: string): HTMLElement {
	const host = document.createElement("div");
	host.innerHTML = html.replaceAll("LONG", LONG);
	document.body.append(host);
	return host;
}

afterEach(() => {
	document.body.replaceChildren();
});

describe("the sideways leak check", () => {
	it.each([
		["wraps in a block", '<p class="break-words">LONG</p>'],
		[
			"wraps in a row item that shrinks",
			'<div class="flex"><p class="min-w-0 break-words">LONG</p></div>',
		],
		[
			"truncates in a row item that shrinks",
			'<div class="flex"><span class="min-w-0 truncate">LONG</span></div>',
		],
		[
			"collapses to a few lines",
			'<p class="line-clamp-3 break-words">LONG</p>',
		],
		[
			"wraps under a column, whose items take its width",
			'<div class="flex flex-col"><p class="break-words">LONG</p></div>',
		],
		[
			"scrolls only up and down",
			'<div class="overflow-y-auto"><p class="break-words">LONG</p></div>',
		],
		["is short enough to need nothing", "<p>a few short words</p>"],
	])("passes text that %s", (_, html) => {
		expect(sidewaysLeaks(tree(html))).toEqual([]);
	});

	it("flags long text nothing wraps", () => {
		expect(sidewaysLeaks(tree('<p class="text-fg">LONG</p>'))).toEqual([
			'does not wrap: <p class="text-fg">',
		]);
	});

	it("flags a line held whole under something that would wrap it", () => {
		const host = tree(
			'<div class="break-words"><span class="whitespace-nowrap">LONG</span></div>',
		);

		expect(sidewaysLeaks(host)).toEqual([
			'does not wrap: <span class="whitespace-nowrap">',
		]);
	});

	it.each([
		"overflow-hidden",
		"overflow-clip",
		"overflow-x-hidden",
		"overflow-x-clip",
	])("flags %s, which hides what does not fit instead of fitting it", (clip) => {
		const host = tree(
			`<div class="${clip}"><p class="break-words">LONG</p></div>`,
		);

		expect(sidewaysLeaks(host)).toEqual([`clips: <div class="${clip}">`]);
	});

	it.each([
		["a row", "flex"],
		["an inline row", "inline-flex"],
		["a grid", "grid"],
	])("flags an item of %s that cannot shrink below its text", (_, layout) => {
		const host = tree(
			`<div class="${layout}"><span class="truncate">LONG</span></div>`,
		);

		expect(sidewaysLeaks(host)).toEqual([
			'cannot shrink: <span class="truncate">',
		]);
	});

	it("flags a row item held at its size, even one that may shrink", () => {
		const host = tree(
			'<div class="flex"><span class="min-w-0 flex-none truncate">LONG</span></div>',
		);

		expect(sidewaysLeaks(host)).toEqual([
			'cannot shrink: <span class="min-w-0 flex-none truncate">',
		]);
	});

	it("reports each leak once, nearest the text first", () => {
		const host = tree(`
			<div class="overflow-hidden">
				<div class="flex"><p class="break-words">LONG</p><p class="break-words">LONG</p></div>
			</div>
		`);

		expect(sidewaysLeaks(host)).toEqual([
			'cannot shrink: <p class="break-words">',
			'clips: <div class="overflow-hidden">',
		]);
	});
});

describe("text in a table", () => {
	it("needs to wrap anywhere, since a cell sizes to its longest word", () => {
		const breaks = tree(
			'<table><tbody><tr><td class="break-words">LONG</td></tr></tbody></table>',
		);
		const anywhere = tree(
			'<table><tbody><tr><td class="wrap-anywhere">LONG</td></tr></tbody></table>',
		);

		expect(sidewaysLeaks(breaks)).toEqual([
			'cell does not wrap anywhere: <td class="break-words">',
		]);
		expect(sidewaysLeaks(anywhere)).toEqual([]);
	});
});

describe("what the browser does unasked", () => {
	it("reads a code block as one line per line unless it is told to wrap", () => {
		expect(sidewaysLeaks(tree('<pre class="break-words">LONG</pre>'))).toEqual([
			'does not wrap: <pre class="break-words">',
		]);
		expect(
			sidewaysLeaks(
				tree('<pre class="whitespace-pre-wrap break-words">LONG</pre>'),
			),
		).toEqual([]);
	});

	it.each([
		"overflow-auto",
		"overflow-scroll",
		"overflow-x-auto",
		"overflow-x-scroll",
	])("flags %s, a box that scrolls sideways inside the chat", (scroll) => {
		const host = tree(
			`<div class="${scroll}"><p class="break-words">LONG</p></div>`,
		);

		expect(sidewaysLeaks(host)).toEqual([
			`scrolls sideways: <div class="${scroll}">`,
		]);
	});
});

describe("what holds no text", () => {
	it.each([
		"left-full",
		"right-full",
		"-right-4",
		"-mx-8",
		"translate-x-full",
		"-translate-x-2",
	])("flags %s, which places a box past the edge it belongs to", (place) => {
		const host = tree(`<div class="absolute ${place}"><button></button></div>`);

		expect(sidewaysLeaks(host)).toEqual([
			`sits outside its box (${place}): <div class="absolute ${place}">`,
		]);
	});

	it("leaves a box placed inside its edge alone", () => {
		expect(
			sidewaysLeaks(tree('<div class="absolute top-2 right-3"></div>')),
		).toEqual([]);
	});
});
