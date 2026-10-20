// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it } from "vitest";
import { emptyLayout, openTab, type SplitLayout } from "./split-layout.ts";
import { SplitView } from "./split-view.tsx";

beforeAll(() => {
	(
		globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
	).IS_REACT_ACT_ENVIRONMENT = true;
	globalThis.ResizeObserver ??= class {
		observe() {}
		unobserve() {}
		disconnect() {}
	} as unknown as typeof ResizeObserver;
});

async function mounted(tree: ReactNode) {
	const host = document.createElement("div");
	document.body.append(host);
	await act(async () => {
		createRoot(host).render(tree);
	});
	return host;
}

function view(layout: SplitLayout<string>, changes: SplitLayout<string>[]) {
	return (
		<SplitView
			layout={layout}
			onChange={(next) => changes.push(next)}
			renderTab={(content) => <p>body of {content}</p>}
			tabLabel={(content) => content}
		/>
	);
}

const two = openTab(
	openTab(emptyLayout<string>(), { id: "a", content: "a" }),
	{ id: "b", content: "b" },
	"right",
);

describe("SplitView", () => {
	it("draws one tab strip per split with the active tab's body", async () => {
		const host = await mounted(view(two, []));
		expect(host.querySelectorAll('[data-slot="tabs-list"]')).toHaveLength(2);
		expect(host.textContent).toContain("body of a");
		expect(host.textContent).toContain("body of b");
	});

	it("closes a tab through its close button", async () => {
		const changes: SplitLayout<string>[] = [];
		const host = await mounted(view(two, changes));
		const close = host.querySelector(
			'[aria-label="close b"]',
		) as HTMLButtonElement;
		await act(async () => close.click());
		expect(changes.at(-1)?.groups).toHaveLength(1);
	});
});
