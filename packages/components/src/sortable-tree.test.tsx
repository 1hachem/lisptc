// @vitest-environment happy-dom
import { act, type ReactNode, StrictMode, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { TreeFolder } from "./file-tree.tsx";
import { SortableTree } from "./sortable-tree.tsx";

beforeAll(() => {
	(
		globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
	).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;

afterEach(async () => {
	await act(async () => root?.unmount());
	root = null;
	document.body.replaceChildren();
});

const ROW = 24;

function box(top: number, height: number) {
	return () =>
		({
			x: 0,
			y: top,
			left: 0,
			top,
			width: 200,
			height,
			right: 200,
			bottom: top + height,
			toJSON() {},
		}) as DOMRect;
}

async function mounted(tree: ReactNode) {
	const host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
	await act(async () => {
		root?.render(<StrictMode>{tree}</StrictMode>);
	});
	const entries = () => [...host.querySelectorAll<HTMLElement>("[data-entry]")];
	const laidOut = () => {
		const rows = entries();
		rows.forEach((el, i) => {
			el.getBoundingClientRect = box(i * ROW, ROW);
		});
		const list = rows[0]?.parentElement;
		if (list) list.getBoundingClientRect = box(0, rows.length * ROW);
	};
	const press = async (code: string) => {
		await act(async () => {
			(document.activeElement as HTMLElement).dispatchEvent(
				new KeyboardEvent("keydown", { code, key: code, bubbles: true }),
			);
			await new Promise((done) => setTimeout(done, 20));
		});
	};
	return {
		host,
		shown: () => entries().map((el) => el.textContent),
		async pickUp(name: string) {
			laidOut();
			entries()
				.find((el) => el.textContent === name)
				?.focus();
			await press("Space");
		},
		async drag(name: string, moves: string[]) {
			await this.pickUp(name);
			for (const code of moves) await press(code);
			await press("Space");
		},
	};
}

function Owner({
	initial,
	saves = true,
}: {
	initial: string[];
	saves?: boolean;
}) {
	const [order, setOrder] = useState(initial);
	return (
		<>
			<button type="button" onClick={() => setOrder([...order].reverse())}>
				reverse
			</button>
			<SortableTree order={order} onReorder={saves ? setOrder : () => {}}>
				{(id) => <span>{id}</span>}
			</SortableTree>
		</>
	);
}

const ORDER = ["home", "chat", "memories", "README.md"];

describe("reordering by dragging", () => {
	it("puts the dragged entry where the one it was dropped on was", async () => {
		const up = await mounted(<Owner initial={ORDER} />);
		await up.drag("README.md", ["ArrowUp", "ArrowUp"]);
		expect(up.shown()).toEqual(["home", "README.md", "chat", "memories"]);
		await act(async () => root?.unmount());
		const down = await mounted(<Owner initial={ORDER} />);
		await down.drag("home", ["ArrowDown", "ArrowDown"]);
		expect(down.shown()).toEqual(["chat", "memories", "home", "README.md"]);
	});

	it("changes nothing when dropped where it was picked up", async () => {
		const ui = await mounted(<Owner initial={ORDER} />);
		await ui.drag("chat", []);
		expect(ui.shown()).toEqual(ORDER);
	});

	it("holds the dropped order while the owner has not saved it yet", async () => {
		const ui = await mounted(<Owner initial={ORDER} saves={false} />);
		await ui.drag("README.md", ["ArrowUp", "ArrowUp"]);
		expect(ui.shown()).toEqual(["home", "README.md", "chat", "memories"]);
	});

	it("follows the owner once its order changes from elsewhere", async () => {
		const ui = await mounted(<Owner initial={ORDER} saves={false} />);
		await ui.drag("README.md", ["ArrowUp", "ArrowUp"]);
		await act(async () => {
			ui.host.querySelector("button")?.click();
		});
		expect(ui.shown()).toEqual(["README.md", "memories", "chat", "home"]);
	});

	it("collapses an open folder while it is being dragged", async () => {
		const ui = await mounted(
			<SortableTree order={["chat", "memories"]} onReorder={() => {}}>
				{(id) => (
					<TreeFolder name={id} open onToggle={() => {}}>
						<span>{`${id} inside`}</span>
					</TreeFolder>
				)}
			</SortableTree>,
		);
		await act(async () => {
			const chat = ui.host.querySelector<HTMLElement>("[data-entry]");
			chat?.focus();
			chat?.dispatchEvent(
				new KeyboardEvent("keydown", { code: "Space", bubbles: true }),
			);
		});
		expect(ui.host.textContent).not.toContain("chat inside");
		expect(ui.host.textContent).toContain("memories inside");
	});
});
