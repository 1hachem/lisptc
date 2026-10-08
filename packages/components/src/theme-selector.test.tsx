// @vitest-environment happy-dom
import type { ThemeDef } from "@repo/ui";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { FontDialog, ThemeDialog } from "./theme-selector.tsx";

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
	const onSelect = vi.fn();
	const onOpenChange = vi.fn();
	const host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
	await act(async () => {
		root?.render(
			<ThemeDialog
				onOpenChange={onOpenChange}
				onSelect={onSelect}
				open
				themes={themes}
				value={value}
			/>,
		);
	});
	return {
		onSelect,
		onOpenChange,
		item: (id: string) =>
			document.querySelector<HTMLElement>(`[data-value="${id}"]`),
		async pick(id: string) {
			await act(async () => {
				document.querySelector<HTMLElement>(`[data-value="${id}"]`)?.click();
			});
		},
	};
}

describe("choosing a theme", () => {
	it("marks the current theme", async () => {
		const ui = await mounted("dusk");
		expect(ui.item("dusk")?.dataset.chosen).toBe("true");
		expect(ui.item("dawn")?.dataset.chosen).toBeUndefined();
	});

	it("lists light themes before dark ones", async () => {
		await mounted("dusk");
		const order = [
			...document.querySelectorAll<HTMLElement>("[cmdk-item]"),
		].map((item) => item.dataset.value);
		expect(order).toEqual(["dawn", "dusk"]);
	});

	it("previews each theme in its own palette", async () => {
		const ui = await mounted("dusk");
		expect(
			ui.item("dawn")?.querySelector('[data-theme="dawn"]'),
		).not.toBeNull();
		expect(
			ui.item("dusk")?.querySelector('[data-theme="dusk"]'),
		).not.toBeNull();
	});

	it("selects another theme and closes", async () => {
		const ui = await mounted("dusk");
		await ui.pick("dawn");
		expect(ui.onSelect).toHaveBeenCalledWith("dawn");
		expect(ui.onOpenChange).toHaveBeenCalledWith(false);
	});

	it("closes without resending the current theme", async () => {
		const ui = await mounted("dusk");
		await ui.pick("dusk");
		expect(ui.onSelect).not.toHaveBeenCalled();
		expect(ui.onOpenChange).toHaveBeenCalledWith(false);
	});
});

describe("choosing a font", () => {
	it("shows each font in its own face and picks one", async () => {
		const onSelect = vi.fn();
		const onOpenChange = vi.fn();
		const host = document.createElement("div");
		document.body.append(host);
		root = createRoot(host);
		await act(async () => {
			root?.render(
				<FontDialog
					fonts={[
						{ id: "mono", name: "Mono" },
						{ id: "sans", name: "Sans" },
					]}
					onOpenChange={onOpenChange}
					onSelect={onSelect}
					open
					value="mono"
				/>,
			);
		});
		const sans = document.querySelector<HTMLElement>('[data-value="sans"]');
		expect(sans?.querySelector('[data-font="sans"]')).not.toBeNull();
		await act(async () => sans?.click());
		expect(onSelect).toHaveBeenCalledWith("sans");
		expect(onOpenChange).toHaveBeenCalledWith(false);
	});
});
