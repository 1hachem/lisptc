// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it } from "vitest";
import { hitAt } from "./drag-layer.tsx";
import {
	type Sides,
	SortableSide,
	SortableSides,
	sidesSpots,
} from "./sortable-sides.tsx";

beforeAll(() => {
	(
		globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
	).IS_REACT_ACT_ENVIRONMENT = true;
});

type Side = "left" | "right";

const ROW = 20;

const sides: Sides<Side, string> = { left: ["a", "b"], right: ["c", "d"] };

function place(element: Element, left: number, top: number, height: number) {
	element.getBoundingClientRect = () =>
		({
			left,
			top,
			width: 100,
			height,
			right: left + 100,
			bottom: top + height,
			x: left,
			y: top,
		}) as DOMRect;
}

async function mounted() {
	const host = document.createElement("div");
	document.body.append(host);
	await act(async () => {
		createRoot(host).render(
			<SortableSides sides={sides} onMove={() => {}} overlay={(id) => id}>
				<SortableSide side="left">{(id) => id}</SortableSide>
				<SortableSide side="right">{(id) => id}</SortableSide>
			</SortableSides>,
		);
	});
	for (const side of host.querySelectorAll("[data-side]")) {
		const left = side.getAttribute("data-side") === "left" ? 0 : 500;
		place(side, left, 0, ROW * 2);
		side.querySelectorAll("[data-entry]").forEach((entry, index) => {
			place(entry, left, index * ROW, ROW);
		});
	}
	return host;
}

async function droppedAt(x: number, y: number) {
	const host = await mounted();
	const kind = host.querySelector("[data-sides]")?.getAttribute("data-sides");
	if (!kind) throw new Error("no sides");
	let next: Sides<Side, string> | undefined;
	const spots = sidesSpots(
		sides,
		kind,
		"a",
		(moved) => {
			next = moved;
		},
		undefined,
	);
	spots[
		hitAt(
			spots.map((spot) => spot.hit),
			x,
			y,
		)
	]?.drop();
	return next;
}

describe("moving an entry to the other side", () => {
	it("lands last when dropped on the lower half of the last entry", async () => {
		expect((await droppedAt(550, ROW * 1.75))?.right).toEqual(["c", "d", "a"]);
	});

	it("lands before the last entry when dropped on its upper half", async () => {
		expect((await droppedAt(550, ROW * 1.25))?.right).toEqual(["c", "a", "d"]);
	});
});
