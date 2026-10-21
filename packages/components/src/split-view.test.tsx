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

const PANEL = "application/x-panel";

function dragEvent(type: string, types = [PANEL]) {
	const event = new Event(type, { bubbles: true, cancelable: true });
	Object.defineProperty(event, "dataTransfer", {
		value: {
			types,
			dropEffect: "none",
			getData: (key: string) => (key === PANEL ? "b" : ""),
		},
	});
	return event;
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

	it("splits below with a file dragged in from outside, previewing where it lands", async () => {
		const changes: SplitLayout<string>[] = [];
		const one = openTab(emptyLayout<string>(), { id: "a", content: "a" });
		const host = await mounted(
			<SplitView
				layout={one}
				onChange={(next) => changes.push(next)}
				renderTab={(content) => <p>body of {content}</p>}
				tabLabel={(content) => content}
				external={{
					type: PANEL,
					read: (data) => {
						const id = data.getData(PANEL);
						return id ? { id, content: id } : undefined;
					},
				}}
			/>,
		);
		await act(async () => host.dispatchEvent(dragEvent("dragenter")));
		const pane = one.groups[0].panes[0].id;
		const bottom = host.querySelector(
			`[data-drop="edge:${pane}:bottom"]`,
		) as HTMLElement;
		expect(bottom).not.toBeNull();
		await act(async () => bottom.dispatchEvent(dragEvent("dragover")));
		expect(host.querySelector(".bg-accent\\/15")).not.toBeNull();
		await act(async () => bottom.dispatchEvent(dragEvent("drop")));
		expect(changes.at(-1)?.groups[0].panes.map((p) => p.tabs[0].id)).toEqual([
			"a",
			"b",
		]);
	});

	it("ignores a drag that carries something else, like a file from the desktop", async () => {
		const host = await mounted(view(two, []));
		await act(async () =>
			host.dispatchEvent(dragEvent("dragenter", ["Files"])),
		);
		expect(host.querySelector("[data-drop]")).toBeNull();
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
