// @vitest-environment happy-dom

import {
	closeTab,
	emptyLayout,
	openTab,
	type SplitLayout,
} from "@repo/shared/split-layout";
import { act, type ComponentProps, type ReactNode, useState } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it } from "vitest";
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

function Owner({
	initial,
	...rest
}: { initial: SplitLayout<string> } & Partial<
	ComponentProps<typeof SplitView<string>>
>) {
	const [layout, setLayout] = useState(initial);
	return (
		<SplitView
			layout={layout}
			onChange={setLayout}
			renderTab={(content) => <p>body of {content}</p>}
			tabLabel={(content) => content}
			{...rest}
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

const external = {
	type: PANEL,
	read: (data: DataTransfer) => {
		const id = data.getData(PANEL);
		return id ? { id, content: id } : undefined;
	},
};

const one = openTab(emptyLayout<string>(), { id: "a", content: "a" });

const two = openTab(one, { id: "b", content: "b" }, "right");

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
		const host = await mounted(
			<SplitView
				layout={two}
				onChange={() => {}}
				renderTab={(content) => <p>body of {content}</p>}
				tabLabel={(content) => content}
			/>,
		);
		const group = () =>
			host.querySelector<HTMLElement>('[data-slot="resizable-panel-group"]');
		await pick(host, 0, "maximize width");
		expect(host.querySelectorAll('[data-slot="tabs-list"]')).toHaveLength(2);
		expect(group()?.style.width).toBe("150%");
		await pick(host, 0, "restore size");
		expect(["", "100%"]).toContain(group()?.style.width);
	});

	it("fills the height with one pane, hiding the ones stacked with it", async () => {
		const stacked = openTab(one, { id: "b", content: "b" }, "down");
		const host = await mounted(<Owner initial={stacked} />);
		await pick(host, 0, "maximize height");
		expect(host.textContent).toContain("body of a");
		expect(host.textContent).not.toContain("body of b");
		await pick(host, 0, "restore size");
		expect(host.textContent).toContain("body of b");
	});
});

describe("SplitView", () => {
	it("splits with a file dragged in from outside onto a pane's edge", async () => {
		const host = await mounted(<Owner initial={one} external={external} />);
		expect(host.textContent).not.toContain("body of b");
		await act(async () => host.dispatchEvent(dragEvent("dragenter")));
		const bottom = host.querySelector(
			`[data-drop="edge:${one.root?.id}:bottom"]`,
		) as HTMLElement;
		await act(async () => bottom.dispatchEvent(dragEvent("dragover")));
		await act(async () => bottom.dispatchEvent(dragEvent("drop")));
		expect(host.textContent).toContain("body of a");
		expect(host.textContent).toContain("body of b");
	});

	it("asks for a drop into a pane whose last tab was closed", async () => {
		const host = await mounted(
			<SplitView
				layout={closeTab(two, "b")}
				onChange={() => {}}
				renderTab={(content) => <p>body of {content}</p>}
				tabLabel={(content) => content}
			/>,
		);
		expect(host.textContent).toContain("body of a");
		expect(host.textContent).toContain("drag anything in here");
	});

	it("shows its placeholder when nothing is open, and takes a drop over it", async () => {
		const host = await mounted(
			<Owner
				initial={emptyLayout<string>()}
				placeholder={<p>come on</p>}
				external={external}
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
		expect(host.textContent).toContain("body of b");
		expect(host.textContent).not.toContain("come on");
	});

	it("closes a tab through its close button", async () => {
		const host = await mounted(<Owner initial={two} />);
		const close = host.querySelector(
			'[aria-label="close b"]',
		) as HTMLButtonElement;
		await act(async () => close.click());
		expect(host.textContent).toContain("body of a");
		expect(host.textContent).not.toContain("body of b");
	});
});
