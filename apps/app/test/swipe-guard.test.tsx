// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it } from "vitest";
import { useNoSwipeNavigation } from "../src/lib/swipe-guard.ts";

beforeAll(() => {
	(
		globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
	).IS_REACT_ACT_ENVIRONMENT = true;
});

function Guarded() {
	useNoSwipeNavigation();
	return null;
}

function wheel(target: Element, deltaX: number, deltaY = 0): WheelEvent {
	const event = new WheelEvent("wheel", {
		deltaX,
		deltaY,
		bubbles: true,
		cancelable: true,
	});
	target.dispatchEvent(event);
	return event;
}

function strip(scrollLeft: number): HTMLElement {
	const element = document.createElement("div");
	element.style.overflowX = "auto";
	Object.defineProperty(element, "scrollWidth", { value: 400 });
	Object.defineProperty(element, "clientWidth", { value: 100 });
	element.scrollLeft = scrollLeft;
	document.body.append(element);
	return element;
}

describe("the swipe guard", () => {
	beforeAll(async () => {
		const host = document.createElement("div");
		document.body.append(host);
		await act(async () => {
			createRoot(host).render(<Guarded />);
		});
	});

	it("keeps a sideways swipe over nothing scrollable from going back", () => {
		expect(wheel(document.body, -40).defaultPrevented).toBe(true);
	});

	it("lets a strip that can still scroll that way have the swipe", () => {
		expect(wheel(strip(50), -40).defaultPrevented).toBe(false);
	});

	it("takes the swipe once the strip is at its edge", () => {
		expect(wheel(strip(0), -40).defaultPrevented).toBe(true);
	});

	it("leaves vertical scrolling alone", () => {
		expect(wheel(document.body, 5, 40).defaultPrevented).toBe(false);
	});
});
