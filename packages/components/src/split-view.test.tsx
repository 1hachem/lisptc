// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it } from "vitest";
import {
	allTabs,
	closeTab,
	emptyLayout,
	openTab,
	paneOf,
	type SplitLayout,
} from "./split-layout.ts";
import { pagedStop, SplitView } from "./split-view.tsx";

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

function sideBySide(count: number): SplitLayout<string> {
	let layout = openTab(emptyLayout<string>(), { id: "t0", content: "t0" });
	for (let i = 1; i < count; i++)
		layout = openTab(layout, { id: `t${i}`, content: `t${i}` }, "right");
	return layout;
}

describe("SplitView side scrolling", () => {
	it("fits two panes side by side in the view", async () => {
		const host = await mounted(view(sideBySide(2), []));
		const group = host.querySelector<HTMLElement>(
			'[data-slot="resizable-panel-group"]',
		);
		expect(["", "100%"]).toContain(group?.style.width);
	});

	it("widens past the view beyond two panes, paged rather than scrolled freely", async () => {
		const host = await mounted(view(sideBySide(5), []));
		const group = host.querySelector<HTMLElement>(
			'[data-slot="resizable-panel-group"]',
		);
		expect(group?.style.width).toBe("250%");
		expect(group?.parentElement?.className).toContain("overflow-hidden");
	});
});

describe("paging between panes", () => {
	const stops = [0, 400, 800, 1000];

	it("springs back below the threshold", () => {
		expect(pagedStop(stops, 1, 60)).toBe(1);
		expect(pagedStop(stops, 1, -60)).toBe(1);
	});

	it("moves one pane once past it, either way", () => {
		expect(pagedStop(stops, 1, 80)).toBe(2);
		expect(pagedStop(stops, 1, -80)).toBe(0);
	});

	it("never moves more than one pane however far the gesture goes", () => {
		expect(pagedStop(stops, 0, 5000)).toBe(1);
	});

	it("measures the threshold against the pane it moves into", () => {
		expect(pagedStop(stops, 2, 39)).toBe(2);
		expect(pagedStop(stops, 2, 40)).toBe(3);
	});

	it("stays put at either end", () => {
		expect(pagedStop(stops, 0, -500)).toBe(0);
		expect(pagedStop(stops, 3, 500)).toBe(3);
	});
});

async function pick(host: HTMLElement, menu: number, item: string) {
	const trigger = host.querySelectorAll<HTMLElement>(
		'[aria-label="split menu"]',
	)[menu];
	await act(async () => {
		trigger?.dispatchEvent(
			new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
		);
	});
	const entry = [
		...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
	].find((el) => el.textContent?.includes(item));
	await act(async () => {
		entry?.click();
	});
}

describe("maximizing a pane", () => {
	it("widens a pane to the whole view and keeps its neighbour a page away", async () => {
		const host = await mounted(view(two, []));
		const group = () =>
			host.querySelector<HTMLElement>('[data-slot="resizable-panel-group"]');
		await pick(host, 0, "maximize width");
		expect(host.querySelectorAll('[data-slot="tabs-list"]')).toHaveLength(2);
		expect(group()?.style.width).toBe("150%");
		await pick(host, 0, "restore size");
		expect(["", "100%"]).toContain(group()?.style.width);
	});

	it("fills the height with one pane, hiding the ones stacked with it", async () => {
		const stacked = openTab(
			openTab(emptyLayout<string>(), { id: "a", content: "a" }),
			{ id: "b", content: "b" },
			"down",
		);
		const host = await mounted(view(stacked, []));
		await pick(host, 0, "maximize height");
		expect(host.querySelectorAll('[data-slot="tabs-list"]')).toHaveLength(1);
		await pick(host, 0, "restore size");
		expect(host.querySelectorAll('[data-slot="tabs-list"]')).toHaveLength(2);
	});

	it("caps each side by side pane at the width of the view", async () => {
		const host = await mounted(view(sideBySide(4), []));
		const group = host.querySelector<HTMLElement>(
			'[data-slot="resizable-panel-group"]',
		);
		expect(group?.style.width).toBe("200%");
	});
});

function pane(layout: SplitLayout<string>, tab: string): string | undefined {
	return paneOf(layout, tab)?.id;
}

describe("SplitView", () => {
	it("focuses a pane when the user presses anywhere in it", async () => {
		const changes: SplitLayout<string>[] = [];
		const host = await mounted(view(two, changes));
		const unfocused = two.focused === pane(two, "a") ? "b" : "a";
		const body = [...host.querySelectorAll("p")].find(
			(p) => p.textContent === `body of ${unfocused}`,
		);
		await act(async () => {
			body?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
		});
		expect(changes.at(-1)?.focused).toBe(pane(two, unfocused));
	});

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
