// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { type Sides, SortableSide, SortableSides } from "./sortable-sides.tsx";

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

type Side = "left" | "right";
const SIDES: Sides<Side, string> = { left: ["a", "b", "c"], right: ["x", "y"] };
const ROW = 24;
const COLUMN: Record<Side, number> = { left: 0, right: 300 };

function box(left: number, top: number, height: number) {
	return () =>
		({
			x: left,
			y: top,
			left,
			top,
			width: 200,
			height,
			right: left + 200,
			bottom: top + height,
			toJSON() {},
		}) as DOMRect;
}

function Owner({
	initial,
	saves,
}: {
	initial: Sides<Side, string>;
	saves: "yes" | "no";
}) {
	const [sides, setSides] = useState(initial);
	return (
		<>
			<SortableSides
				sides={sides}
				onMove={saves === "yes" ? setSides : () => {}}
				overlay={(id) => <span>{id}</span>}
			>
				{(["left", "right"] as const).map((side) => (
					<SortableSide key={side} side={side}>
						{(id) => <span>{id}</span>}
					</SortableSide>
				))}
			</SortableSides>
			<button type="button" onClick={() => setSides({ ...initial })}>
				undo
			</button>
			<button
				type="button"
				onClick={() => setSides({ left: ["c", "b", "a"], right: ["y", "x"] })}
			>
				elsewhere
			</button>
		</>
	);
}

async function mounted(saves: "yes" | "no" = "yes", initial = SIDES) {
	const host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
	await act(async () => {
		root?.render(<Owner initial={initial} saves={saves} />);
	});
	const column = (side: Side) =>
		host.querySelector(`[data-side="${side}"]`) as HTMLElement;
	const rows = (side: Side) => [
		...column(side).querySelectorAll<HTMLElement>("[data-entry]"),
	];
	const laidOut = () => {
		for (const side of ["left", "right"] as const) {
			column(side).getBoundingClientRect = box(COLUMN[side], 0, 5 * ROW);
			rows(side).forEach((el, i) => {
				el.getBoundingClientRect = box(COLUMN[side], i * ROW, ROW);
			});
		}
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
		shown: () => ({
			left: rows("left").map((el) => el.textContent),
			right: rows("right").map((el) => el.textContent),
		}),
		async drag(name: string, moves: string[]) {
			laidOut();
			[...rows("left"), ...rows("right")]
				.find((el) => el.textContent === name)
				?.focus();
			await press("Space");
			for (const code of moves) await press(code);
			await press("Space");
		},
		async click(label: string) {
			await act(async () => {
				[...host.querySelectorAll("button")]
					.find((b) => b.textContent === label)
					?.click();
			});
		},
	};
}

describe("moving an entry between sides", () => {
	it("reorders within a side, onto the entry it was dropped on", async () => {
		const ui = await mounted();
		await ui.drag("a", ["ArrowDown", "ArrowDown"]);
		expect(ui.shown()).toEqual({ left: ["b", "a", "c"], right: ["x", "y"] });
	});

	it("moves across into the other side", async () => {
		const ui = await mounted();
		await ui.drag("b", ["ArrowRight"]);
		expect(ui.shown().left).toEqual(["a", "c"]);
		expect(ui.shown().right).toContain("b");
		expect(ui.shown().right).toHaveLength(3);
	});

	it("moves across onto an empty side", async () => {
		const ui = await mounted("yes", { left: ["a"], right: [] });
		await ui.drag("a", ["ArrowRight"]);
		expect(ui.shown()).toEqual({ left: [], right: ["a"] });
	});

	it("does nothing when dropped where it was picked up", async () => {
		const ui = await mounted();
		await ui.drag("a", []);
		expect(ui.shown()).toEqual(SIDES);
	});
});

describe("the order held after a drop", () => {
	it("shows the dropped order while the owner has not stored it yet", async () => {
		const ui = await mounted("no");
		await ui.drag("a", ["ArrowDown", "ArrowDown"]);
		expect(ui.shown()).toEqual({ left: ["b", "a", "c"], right: ["x", "y"] });
	});

	it("follows the stored order once it changes from elsewhere", async () => {
		const ui = await mounted("no");
		await ui.drag("a", ["ArrowDown", "ArrowDown"]);
		await ui.click("elsewhere");
		expect(ui.shown()).toEqual({ left: ["c", "b", "a"], right: ["y", "x"] });
	});

	it("shows the old order again when a failed save puts it back", async () => {
		const ui = await mounted("yes");
		await ui.drag("a", ["ArrowDown", "ArrowDown"]);
		expect(ui.shown().left).toEqual(["b", "a", "c"]);
		await ui.click("undo");
		expect(ui.shown()).toEqual(SIDES);
	});
});
