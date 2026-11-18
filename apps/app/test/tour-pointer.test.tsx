// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
	ARROWS,
	arrowFor,
	CLICK_POINTER_MS,
	fitOval,
	ovalAround,
	POINTER_MS,
	TourPointer,
	visibleBox,
} from "../src/components/tour-pointer.tsx";

beforeAll(() => {
	(
		globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
	).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
	vi.useRealTimers();
	document.body.replaceChildren();
});

function target(left = 20, top = 400, width = 24): HTMLElement {
	const element = document.createElement("button");
	element.getBoundingClientRect = () => new DOMRect(left, top, width, 24);
	document.body.append(element);
	return element;
}

function shown(
	element: HTMLElement | undefined,
	onDone = () => {},
	mark: "arrow" | "oval" = "arrow",
	size: "small" | "medium" | "large" = "medium",
	extra: { click?: boolean } = {},
) {
	const root = createRoot(document.createElement("div"));
	act(() =>
		root.render(
			<TourPointer
				element={element}
				mark={mark}
				size={size}
				seed="p1"
				onDone={onDone}
				{...extra}
			/>,
		),
	);
	return {
		pointer: () => document.querySelector('[data-testid="tour-pointer"]'),
		close: () => act(() => root.unmount()),
	};
}

describe("the tour pointer", () => {
	it("draws an arrow beside its anchor with no overlay", () => {
		const { pointer, close } = shown(target());
		expect(pointer()?.getAttribute("data-side")).toBe("right");
		expect(pointer()?.querySelector('[role="img"]')).not.toBeNull();
		expect(document.querySelector('[data-testid="tour-spotlight"]')).toBeNull();
		expect(document.querySelector('[aria-label="tour"]')).toBeNull();
		close();
	});

	it("draws the same arrow for the same pointer, and every arrow for some", () => {
		expect(arrowFor("p1")).toBe(arrowFor("p1"));
		const seen = new Set(
			Array.from({ length: 50 }, (_, at) => arrowFor(`pointer-${at}`)),
		);
		expect(seen).toEqual(new Set(ARROWS));
		const { pointer, close } = shown(target(), () => {}, "arrow", "medium");
		expect(pointer()?.querySelector("path")?.getAttribute("d")).toBe(
			arrowFor("p1"),
		);
		close();
	});

	it("draws a bigger arrow for a bigger size", () => {
		const widths = (["small", "medium", "large"] as const).map((size) => {
			const { pointer, close } = shown(target(), () => {}, "arrow", size);
			const width = Number(
				pointer()?.querySelector("svg")?.getAttribute("width"),
			);
			close();
			return width;
		});
		expect(widths).toEqual([...widths].sort((a, b) => a - b));
		expect(new Set(widths).size).toBe(3);
	});

	it("draws in the theme's own colour", () => {
		const { pointer, close } = shown(target(), () => {}, "arrow", "medium");
		expect(pointer()?.querySelector("svg")?.getAttribute("stroke")).toBe(
			"var(--primary)",
		);
		close();
	});

	it("clicks, with a burst on the centre of its target, and is done sooner", () => {
		vi.useFakeTimers();
		const onDone = vi.fn();
		const { pointer, close } = shown(target(), onDone, "arrow", "medium", {
			click: true,
		});
		expect(pointer()?.getAttribute("data-click")).toBe("true");
		const burst = document.querySelector<SVGElement>("[data-click-burst]");
		expect(burst).not.toBeNull();
		expect(Number.parseFloat(burst?.style.left ?? "")).toBe(20 + 12 - 20);
		expect(Number.parseFloat(burst?.style.top ?? "")).toBe(400 + 12 - 20);
		act(() => vi.advanceTimersByTime(CLICK_POINTER_MS));
		expect(onDone).toHaveBeenCalledOnce();
		expect(CLICK_POINTER_MS).toBeLessThan(POINTER_MS);
		close();
	});

	it("draws each arrow as one unbroken stroke", () => {
		for (const arrow of ARROWS) expect(arrow.match(/M/g)).toHaveLength(1);
	});

	it("draws an oval round its anchor, centred on it, in one stroke", () => {
		const { pointer, close } = shown(target(400, 300), () => {}, "oval");
		const oval = ovalAround(fitOval(24, 24, "medium"), "p1");
		expect(pointer()?.getAttribute("data-mark")).toBe("oval");
		const style = (pointer() as HTMLElement | null)?.style;
		expect(Number.parseFloat(style?.left ?? "")).toBeCloseTo(
			400 + 12 - oval.width / 2,
		);
		expect(Number.parseFloat(style?.top ?? "")).toBeCloseTo(
			300 + 12 - oval.height / 2,
		);
		expect(pointer()?.querySelector("path")?.getAttribute("d")).toBe(oval.d);
		expect(oval.d.match(/M/g)).toHaveLength(1);
		close();
	});

	it("goes round three times", () => {
		const oval = ovalAround(fitOval(24, 24, "medium"), "p1");
		const points = [...oval.d.matchAll(/(-?[\d.]+) (-?[\d.]+)(?=,|$| C)/g)].map(
			([, x, y]) => [Number(x), Number(y)] as const,
		);
		const [cx, cy] = [oval.width / 2, oval.height / 2];
		let turned = 0;
		for (let i = 1; i < points.length; i++) {
			const [ax, ay] = points[i - 1] as readonly [number, number];
			const [bx, by] = points[i] as readonly [number, number];
			let step = Math.atan2(by - cy, bx - cx) - Math.atan2(ay - cy, ax - cx);
			if (step > Math.PI) step -= 2 * Math.PI;
			if (step < -Math.PI) step += 2 * Math.PI;
			turned += step;
		}
		expect(Math.floor(Math.abs(turned) / (2 * Math.PI))).toBe(3);
	});

	const TARGETS = [
		[14, 14],
		[24, 24],
		[62, 18],
		[180, 24],
		[640, 90],
		[900, 22],
		[260, 160],
	] as const;

	it("clears the corners of what it circles, at every size", () => {
		for (const size of ["small", "medium", "large"] as const)
			for (const [w, h] of TARGETS) {
				const { rx, ry, roundness } = fitOval(w, h, size);
				expect(
					(w / 2 / rx) ** roundness + (h / 2 / ry) ** roundness,
				).toBeLessThan(1);
			}
	});

	it("keeps an even gap, so a long element gets no long overshoot", () => {
		for (const [w, h] of TARGETS.filter(([w, h]) => w / h >= 3)) {
			const { rx } = fitOval(w, h, "medium");
			expect(rx - w / 2).toBeLessThan(45);
		}
		const bar = fitOval(900, 22, "medium");
		expect(bar.rx - 450).toBeLessThan(bar.ry * 1.5);
	});

	it("sits looser for a bigger size, and never shrinks a tiny target away", () => {
		for (const [w, h] of TARGETS) {
			const small = fitOval(w, h, "small");
			const medium = fitOval(w, h, "medium");
			const large = fitOval(w, h, "large");
			expect(small.ry).toBeLessThan(medium.ry);
			expect(medium.ry).toBeLessThan(large.ry);
		}
		const icon = fitOval(14, 14, "small");
		expect(Math.min(icon.rx, icon.ry)).toBeGreaterThanOrEqual(14);
	});

	it("stays inside the room it is given", () => {
		const fit = fitOval(900, 22, "large", { rx: 300, ry: 20 });
		expect(fit.rx).toBe(300);
		expect(fit.ry).toBe(20);
	});

	it("draws a different oval for each pointer, the same for one", () => {
		const fit = fitOval(24, 24, "medium");
		expect(ovalAround(fit, "p1").d).toBe(ovalAround(fit, "p1").d);
		expect(ovalAround(fit, "p1").d).not.toBe(ovalAround(fit, "p2").d);
	});

	it("measures what is drawn inside an element, not its empty width", () => {
		const row = document.createElement("a");
		row.getBoundingClientRect = () => new DOMRect(0, 100, 240, 24);
		const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
		icon.getBoundingClientRect = () => new DOMRect(8, 106, 12, 12);
		row.append(icon);
		document.body.append(row);
		expect(visibleBox(row)).toEqual({
			top: 106,
			left: 8,
			width: 12,
			height: 12,
		});
	});

	it("measures a bordered element as a whole", () => {
		const button = document.createElement("button");
		button.style.border = "1px solid red";
		button.getBoundingClientRect = () => new DOMRect(0, 0, 80, 26);
		const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
		icon.getBoundingClientRect = () => new DOMRect(4, 7, 12, 12);
		button.append(icon);
		document.body.append(button);
		expect(visibleBox(button)).toEqual({
			top: 0,
			left: 0,
			width: 80,
			height: 26,
		});
	});

	it("draws nothing while its anchor is not on screen", () => {
		const { pointer, close } = shown(undefined);
		expect(pointer()).toBeNull();
		close();
	});

	it("is done after a few seconds", () => {
		vi.useFakeTimers();
		const onDone = vi.fn();
		const { close } = shown(target(), onDone);
		act(() => vi.advanceTimersByTime(POINTER_MS - 1));
		expect(onDone).not.toHaveBeenCalled();
		act(() => vi.advanceTimersByTime(1));
		expect(onDone).toHaveBeenCalledOnce();
		close();
	});
});
