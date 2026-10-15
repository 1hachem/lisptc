// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PromptDialog } from "./prompt-dialog.tsx";

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

async function mounted(prompts: string[]) {
	const onSelect = vi.fn();
	const onOpenChange = vi.fn();
	const host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
	await act(async () => {
		root?.render(
			<PromptDialog
				onOpenChange={onOpenChange}
				onSelect={onSelect}
				open
				prompts={prompts}
			/>,
		);
	});
	return { onSelect, onOpenChange };
}

function items() {
	return [...document.querySelectorAll<HTMLElement>("[cmdk-item]")];
}

describe("searching previous prompts", () => {
	it("lists the prompts in the order given, each on one line", async () => {
		await mounted(["newest", "two\nlines"]);
		expect(items().map((item) => item.textContent)).toEqual([
			"newest",
			"two lines",
		]);
	});

	it("hands back the whole prompt and closes", async () => {
		const ui = await mounted(["newest", "two\nlines"]);
		await act(async () => items()[1]?.click());
		expect(ui.onSelect).toHaveBeenCalledWith("two\nlines");
		expect(ui.onOpenChange).toHaveBeenCalledWith(false);
	});
});
