// @vitest-environment happy-dom

import {
	allTabs,
	closeTab,
	type Drop,
	dropTab,
	emptyLayout,
	type Node,
	openTab,
	paneOf,
	type SplitLayout,
} from "@repo/shared/split-layout";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it } from "vitest";
import { hitAt } from "./drag-layer.tsx";
import { pagedStop, SplitView, splitSpots, widthFloor } from "./split-view.tsx";

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

function placed(
	element: Element | null,
	left: number,
	top: number,
	width: number,
	height: number,
) {
	if (!element) throw new Error("nothing to place");
	element.getBoundingClientRect = () =>
		({
			left,
			top,
			width,
			height,
			right: left + width,
			bottom: top + height,
			x: left,
			y: top,
		}) as DOMRect;
}

function stageOf(host: HTMLElement): Element {
	const stage = host.querySelector("[data-animated]");
	if (!stage) throw new Error("no stage");
	return stage;
}

function dropAt<T>(
	host: HTMLElement,
	layout: SplitLayout<T>,
	x: number,
	y: number,
): Drop | undefined {
	let dropped: Drop | undefined;
	const spots = splitSpots(stageOf(host), layout, (drop) => {
		dropped = drop;
	});
	spots[
		hitAt(
			spots.map((spot) => spot.hit),
			x,
			y,
		)
	]?.drop();
	return dropped;
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

describe("the width a pane cannot shrink below", () => {
	const floor = (content: string) => (content === "chat" ? 360 : 0);
	const pane = (...contents: string[]): Node<string> => ({
		kind: "pane",
		id: contents.join(),
		tabs: contents.map((content, i) => ({ id: `${i}`, content })),
		active: "0",
	});
	const split = (
		direction: "row" | "column",
		...children: Node<string>[]
	): Node<string> => ({
		kind: "split",
		id: direction,
		direction,
		children,
		sizes: children.map(() => 100 / children.length),
	});

	it("holds a pane to its widest tab", () => {
		expect(widthFloor(pane("file", "chat"), floor)).toBe(360);
		expect(widthFloor(pane("file"), floor)).toBe(0);
	});

	it("adds up side by side panes and takes the widest of stacked ones", () => {
		expect(widthFloor(split("row", pane("chat"), pane("chat")), floor)).toBe(
			720,
		);
		expect(widthFloor(split("column", pane("chat"), pane("chat")), floor)).toBe(
			360,
		);
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

	it("splits below when a tab is dropped in the lower quarter of a pane", async () => {
		const one = openTab(emptyLayout<string>(), { id: "a", content: "a" });
		const host = await mounted(view(one, []));
		placed(stageOf(host), 0, 0, 400, 300);
		placed(host.querySelector("[data-pane-body]"), 0, 30, 400, 270);
		const drop = dropAt(host, one, 200, 260);
		expect(drop).toEqual({ pane: one.root?.id, edge: "bottom" });
		const root = dropTab(one, { id: "b", content: "b" }, drop as Drop).root;
		expect(root?.kind === "split" && root.direction).toBe("column");
	});

	it("joins a pane when a tab is dropped in its middle", async () => {
		const one = openTab(emptyLayout<string>(), { id: "a", content: "a" });
		const host = await mounted(view(one, []));
		placed(stageOf(host), 0, 0, 400, 300);
		placed(host.querySelector("[data-pane-body]"), 0, 30, 400, 270);
		expect(dropAt(host, one, 200, 160)).toEqual({ pane: one.root?.id });
	});

	it("inserts a tab where the strip slot under the pointer is", async () => {
		const host = await mounted(view(two, []));
		placed(stageOf(host), 0, 0, 800, 300);
		const slots = host.querySelectorAll("[data-tab-slot]");
		for (const [index, slot] of [...slots].entries())
			placed(slot, index * 100, 0, 100, 30);
		placed(
			host.querySelectorAll("[data-pane-body]")[0] ?? null,
			0,
			30,
			400,
			270,
		);
		const first = slots[0]?.getAttribute("data-pane");
		expect(dropAt(host, two, 50, 15)).toEqual({ pane: first, index: 0 });
	});

	it("shows its placeholder when nothing is open, and takes a drop over it", async () => {
		const host = await mounted(
			<SplitView
				layout={emptyLayout<string>()}
				onChange={() => {}}
				renderTab={(content) => content}
				tabLabel={(content) => content}
				placeholder={<p>come on</p>}
			/>,
		);
		expect(host.textContent).toContain("come on");
		placed(stageOf(host), 0, 0, 400, 300);
		expect(dropAt(host, emptyLayout<string>(), 120, 80)).toEqual({ pane: "" });
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
