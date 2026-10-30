// @vitest-environment happy-dom
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
	ANCHOR_IDS,
	anchorOf,
	contentRegion,
	PAGE_IDS,
} from "@repo/ui-catalog";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { unpointable, useAnchorElement } from "../src/lib/anchors.ts";
import { panelTab } from "../src/lib/panel-ops.ts";

beforeAll(() => {
	(
		globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
	).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
	document.body.replaceChildren();
});

const PLACED_IN = [resolve("src")];

function sourcesUnder(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return sourcesUnder(path);
		return /\.tsx?$/.test(entry.name) ? [path] : [];
	});
}

function placedAnchors(): Set<string> {
	const placed = new Set<string>();
	for (const file of PLACED_IN.flatMap(sourcesUnder))
		for (const [, id] of readFileSync(file, "utf8").matchAll(
			/anchorOf\(\s*"([^"]+)"\s*\)/g,
		))
			placed.add(id as string);
	return placed;
}

let seen: HTMLElement | undefined;

function Composer({ shown }: { shown: boolean }) {
	seen = useAnchorElement("composer/send");
	return shown ? <button type="button" {...anchorOf("composer/send")} /> : null;
}

function rendered(html: string): HTMLElement {
	const host = document.createElement("div");
	host.innerHTML = html;
	document.body.append(host);
	return host;
}

describe("an anchor", () => {
	it("finds the element marked with it, and loses it once gone", async () => {
		const host = document.createElement("div");
		document.body.append(host);
		const root = createRoot(host);
		act(() => root.render(<Composer shown />));
		await act(async () => {});
		expect(seen).toBe(host.querySelector("button"));
		act(() => root.render(<Composer shown={false} />));
		await act(async () => {});
		expect(seen).toBeUndefined();
		act(() => root.unmount());
	});

	it("is placed somewhere in the app for every one the catalog declares", () => {
		const placed = placedAnchors();
		expect(ANCHOR_IDS.filter((id) => !placed.has(id))).toEqual([]);
	});

	it("opens every catalog page under the tab id the agent names", () => {
		for (const page of PAGE_IDS)
			expect(panelTab({ kind: "page", page, title: page }).id).toBe(
				`page:${page}`,
			);
	});
});

describe("a control nobody can point at", () => {
	it("is any interactive element with no anchor on it or above it", () => {
		const host = rendered(`
			<button id="bare">x</button>
			<a id="link" href="/somewhere">x</a>
			<a id="label">not a link</a>
			<input id="hidden" type="hidden" />
			<button id="marked" data-anchor="composer/send">x</button>
			<div data-anchor="right/theme"><button id="inside">x</button></div>
		`);
		expect(unpointable(host).map((element) => element.id)).toEqual([
			"bare",
			"link",
		]);
	});

	it("is never the wrapper a sortable entry is dragged by", () => {
		const host = rendered(`
			<div role="button" tabindex="0" aria-roledescription="sortable">
				<a href="/x" data-anchor="home">home</a>
			</div>
		`);
		expect(unpointable(host)).toEqual([]);
	});

	it("is never content, a dialog or a menu", () => {
		const host = rendered(`
			<div ${Object.keys(contentRegion)[0]}><a id="in-message" href="/x">x</a></div>
			<div role="dialog"><button id="in-dialog">x</button></div>
			<div role="menu"><button id="in-menu">x</button></div>
			<div role="listbox"><div id="option" role="button">x</div></div>
		`);
		expect(unpointable(host)).toEqual([]);
	});
});
