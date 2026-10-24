// @vitest-environment happy-dom
import { act, type ReactNode, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { TreeFolder } from "./file-tree.tsx";
import {
	awaitingOrder,
	moved,
	ownSize,
	SortableTree,
	slotShift,
	unzoomed,
} from "./sortable-tree.tsx";

beforeAll(() => {
	(
		globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
	).IS_REACT_ACT_ENVIRONMENT = true;
});

async function mounted(tree: ReactNode) {
	const host = document.createElement("div");
	document.body.append(host);
	await act(async () => {
		createRoot(host).render(<StrictMode>{tree}</StrictMode>);
	});
	return host;
}

describe("moved", () => {
	const order = ["home", "chat", "memories", "README.md"];

	it("puts the dragged entry where the one it was dropped on was", () => {
		expect(moved(order, "README.md", "chat")).toEqual([
			"home",
			"README.md",
			"chat",
			"memories",
		]);
		expect(moved(order, "home", "memories")).toEqual([
			"chat",
			"memories",
			"home",
			"README.md",
		]);
	});

	it("changes nothing when dropped on itself, outside, or on a stranger", () => {
		expect(moved(order, "chat", "chat")).toBeUndefined();
		expect(moved(order, "chat", undefined)).toBeUndefined();
		expect(moved(order, "chat", "bogus")).toBeUndefined();
	});
});

describe("awaitingOrder", () => {
	const order = ["home", "chat", "memories"];
	const next = ["chat", "home", "memories"];

	it("holds the dropped order until the owner hands a new one", () => {
		expect(awaitingOrder([...order], { next, over: order })).toBe(next);
	});

	it("follows the owner once its order changes, whichever way", () => {
		expect(awaitingOrder(next, { next, over: order })).toBe(next);
		const elsewhere = ["memories", "home", "chat"];
		expect(awaitingOrder(elsewhere, { next, over: order })).toBe(elsewhere);
		expect(awaitingOrder(order, undefined)).toBe(order);
	});
});

describe("slotShift", () => {
	const rect = (left: number, width: number) => ({
		left,
		width,
		right: left + width,
		top: 0,
		bottom: 24,
		height: 24,
	});
	const bar = [rect(0, 60), rect(470, 40), rect(700, 300)];

	it("moves a neighbour onto the slot it takes, however far apart the slots sit", () => {
		expect(slotShift(bar, 0, 2, 1)).toBe(-470);
		expect(slotShift(bar, 0, 2, 2)).toBe(-230);
		expect(slotShift(bar, 2, 0, 0)).toBe(450);
		expect(slotShift(bar, 2, 0, 1)).toBe(490);
	});

	it("keeps every shifted entry inside the bar", () => {
		for (const [active, over] of [
			[0, 2],
			[2, 0],
			[1, 2],
			[1, 0],
		] as const) {
			bar.forEach((at, index) => {
				const x = slotShift(bar, active, over, index);
				expect(at.left + x).toBeGreaterThanOrEqual(-at.width);
				expect(at.right + x).toBeLessThanOrEqual(1000);
			});
		}
	});

	it("leaves the dragged entry and those outside the move alone", () => {
		expect(slotShift(bar, 0, 1, 0)).toBe(0);
		expect(slotShift(bar, 0, 1, 2)).toBe(0);
	});
});

describe("ownSize", () => {
	const overNarrower = { x: -400, y: 0, scaleX: 0.05, scaleY: 1 };

	it("keeps the dragged entry its own size whatever it is over", () => {
		expect(ownSize(overNarrower, "slide")).toEqual({
			x: -400,
			y: 0,
			scaleX: 1,
			scaleY: 1,
		});
	});

	it("lifts it by the lift scale alone", () => {
		expect(ownSize(overNarrower, "lift")).toMatchObject({
			scaleX: 1.02,
			scaleY: 1.02,
		});
	});
});

describe("unzoomed", () => {
	it("scales the pointer's screen distance back into the zoomed layout", () => {
		expect(unzoomed({ x: 35, y: 175, scaleX: 1, scaleY: 1 }, 1.75)).toEqual({
			x: 20,
			y: 100,
			scaleX: 1,
			scaleY: 1,
		});
	});

	it("leaves an unzoomed or absent transform alone", () => {
		const transform = { x: 3, y: 4, scaleX: 1, scaleY: 1 };
		expect(unzoomed(transform, 1)).toBe(transform);
		expect(unzoomed(null, 1.75)).toBeNull();
	});
});

describe("SortableTree", () => {
	it("renders every entry in the order it is given", async () => {
		const host = await mounted(
			<SortableTree order={["b", "a", "c"]} onReorder={() => {}}>
				{(id) => <span>{id}</span>}
			</SortableTree>,
		);
		const entries = [...host.querySelectorAll("[data-entry]")];
		expect(entries.map((entry) => entry.textContent)).toEqual(["b", "a", "c"]);
	});

	it("moves the way it is asked to", async () => {
		const host = await mounted(
			<SortableTree order={["a"]} onReorder={() => {}} motion="lift">
				{(id) => <span>{id}</span>}
			</SortableTree>,
		);
		expect(
			host.querySelector("[data-motion]")?.getAttribute("data-motion"),
		).toBe("lift");
	});

	it("drops every animation when the user asks for reduced motion", async () => {
		const matchMedia = vi.spyOn(window, "matchMedia").mockImplementation(
			(query) =>
				({
					matches: query === "(prefers-reduced-motion: reduce)",
					addEventListener: () => {},
					removeEventListener: () => {},
				}) as unknown as MediaQueryList,
		);
		const host = await mounted(
			<SortableTree order={["a"]} onReorder={() => {}} motion="overlay">
				{(id) => <span>{id}</span>}
			</SortableTree>,
		);
		expect(
			host.querySelector("[data-motion]")?.getAttribute("data-motion"),
		).toBe("none");
		matchMedia.mockRestore();
	});

	it("collapses an open folder while it is being dragged", async () => {
		const host = await mounted(
			<SortableTree order={["chat", "memories"]} onReorder={() => {}}>
				{(id) => (
					<TreeFolder name={id} open onToggle={() => {}}>
						<span data-child={id} />
					</TreeFolder>
				)}
			</SortableTree>,
		);
		const chat = host.querySelector<HTMLElement>('[data-entry="chat"]');
		await act(async () => {
			chat?.focus();
			chat?.dispatchEvent(
				new KeyboardEvent("keydown", { code: "Space", bubbles: true }),
			);
		});
		expect(chat?.getAttribute("data-dragging")).toBe("true");
		expect(chat?.querySelector("[data-open]")?.getAttribute("data-open")).toBe(
			"false",
		);
		expect(host.querySelector('[data-child="chat"]')).toBeNull();
		expect(host.querySelector('[data-child="memories"]')).not.toBeNull();
	});

	it("tells which entry was picked up", async () => {
		const onPickUp = vi.fn();
		const host = await mounted(
			<SortableTree
				order={["chat", "memories"]}
				onReorder={() => {}}
				onPickUp={onPickUp}
			>
				{(id) => <span>{id}</span>}
			</SortableTree>,
		);
		const memories = host.querySelector<HTMLElement>('[data-entry="memories"]');
		await act(async () => {
			memories?.focus();
			memories?.dispatchEvent(
				new KeyboardEvent("keydown", { code: "Space", bubbles: true }),
			);
		});
		expect(onPickUp).toHaveBeenCalledWith("memories");
	});
});
