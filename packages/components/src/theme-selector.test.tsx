// @vitest-environment happy-dom
import type { ThemeDef } from "@repo/ui";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ThemeDialog } from "./theme-selector.tsx";

beforeAll(() => {
	(
		globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
	).IS_REACT_ACT_ENVIRONMENT = true;
	globalThis.ResizeObserver ??= class {
		observe() {}
		unobserve() {}
		disconnect() {}
	};
	Element.prototype.scrollIntoView ??= () => {};
});

let root: Root | null = null;

afterEach(async () => {
	await act(async () => root?.unmount());
	root = null;
	document.body.replaceChildren();
});

const themes: ThemeDef[] = [
	{
		id: "dusk",
		name: "dusk",
		scheme: "dark",
	},
	{
		id: "dawn",
		name: "dawn",
		scheme: "light",
	},
];

async function mounted(value: string) {
	const host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
	await act(async () => {
		root?.render(
			<ThemeDialog
				onOpenChange={() => {}}
				onSelect={() => {}}
				open
				themes={themes}
				value={value}
			/>,
		);
	});
}

describe("choosing a theme", () => {
	it("lists light themes before dark ones", async () => {
		await mounted("dusk");
		const order = [
			...document.querySelectorAll<HTMLElement>("[cmdk-item]"),
		].map((item) => item.dataset.value);
		expect(order).toEqual(["dawn", "dusk"]);
	});
});
