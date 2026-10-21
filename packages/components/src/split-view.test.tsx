// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it } from "vitest";
import {
	allTabs,
	closeTab,
	emptyLayout,
	openTab,
	type SplitLayout,
} from "./split-layout.ts";
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
		const pane = one.root?.id as string;
		const bottom = host.querySelector(
			`[data-drop="edge:${pane}:bottom"]`,
		) as HTMLElement;
		expect(bottom).not.toBeNull();
		await act(async () => bottom.dispatchEvent(dragEvent("dragover")));
		expect(host.querySelector(".bg-accent\\/15")).not.toBeNull();
		await act(async () => bottom.dispatchEvent(dragEvent("drop")));
		const root = changes.at(-1)?.root;
		expect(root?.kind === "split" && root.direction).toBe("column");
		expect(
			allTabs(changes.at(-1) as SplitLayout<string>).map((t) => t.id),
		).toEqual(["a", "b"]);
	});

	it("ignores a drag that carries something else, like a file from the desktop", async () => {
		const host = await mounted(view(two, []));
		await act(async () =>
			host.dispatchEvent(dragEvent("dragenter", ["Files"])),
		);
		expect(host.querySelector("[data-drop]")).toBeNull();
	});

	it("zooms in only the pane an opening creates, not the ones already there", async () => {
		const host = document.createElement("div");
		document.body.append(host);
		const root = createRoot(host);
		const draw = (layout: SplitLayout<string>) => (
			<SplitView
				layout={layout}
				onChange={() => {}}
				renderTab={(content) => content}
				tabLabel={(content) => content}
				animated
			/>
		);
		const one = openTab(emptyLayout<string>(), { id: "a", content: "a" });
		await act(async () => root.render(draw(one)));
		expect(host.querySelector('[class*="animate-zoom-in"]')).toBeNull();
		await act(async () =>
			root.render(draw(openTab(one, { id: "b", content: "b" }, "right"))),
		);
		expect(host.querySelectorAll('[class*="animate-zoom-in"]')).toHaveLength(1);
	});

	it("animates panes only when asked to", async () => {
		const still = await mounted(view(two, []));
		expect(still.querySelector('[data-animated="true"]')).toBeNull();
		const moving = await mounted(
			<SplitView
				layout={two}
				onChange={() => {}}
				renderTab={(content) => content}
				tabLabel={(content) => content}
				animated
			/>,
		);
		expect(moving.querySelector('[data-animated="true"]')).not.toBeNull();
	});

	it("asks for a drop into a pane whose last tab was closed", async () => {
		const host = await mounted(view(closeTab(two, "b"), []));
		expect(host.textContent).toContain("body of a");
		expect(host.textContent).toContain("drag anything in here");
	});

	it("shows its placeholder when nothing is open, and takes a drop over it", async () => {
		const changes: SplitLayout<string>[] = [];
		const host = await mounted(
			<SplitView
				layout={emptyLayout<string>()}
				onChange={(next) => changes.push(next)}
				renderTab={(content) => content}
				tabLabel={(content) => content}
				placeholder={<p>come on</p>}
				external={{
					type: PANEL,
					read: (data) => ({ id: "b", content: data.getData(PANEL) }),
				}}
			/>,
		);
		expect(host.textContent).toContain("come on");
		await act(async () => {
			window.dispatchEvent(dragEvent("dragenter"));
		});
		const zone = host.querySelector('[data-drop="view"]') as HTMLElement;
		await act(async () => {
			zone.dispatchEvent(dragEvent("drop"));
		});
		expect(allTabs(changes[0]).map((t) => t.id)).toEqual(["b"]);
	});

	it("closes a tab through its close button", async () => {
		const changes: SplitLayout<string>[] = [];
		const host = await mounted(view(two, changes));
		const close = host.querySelector(
			'[aria-label="close b"]',
		) as HTMLButtonElement;
		await act(async () => close.click());
		expect(
			allTabs(changes.at(-1) as SplitLayout<string>).map((t) => t.id),
		).toEqual(["a"]);
	});
});
