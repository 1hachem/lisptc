import { useEffect } from "react";

function canScrollSideways(from: EventTarget | null, dx: number): boolean {
	for (
		let at = from instanceof Element ? from : null;
		at !== null;
		at = at.parentElement
	) {
		if (at.scrollWidth <= at.clientWidth) continue;
		const overflow = getComputedStyle(at).overflowX;
		if (overflow === "hidden" || overflow === "visible" || overflow === "clip")
			continue;
		const room =
			dx > 0 ? at.scrollWidth - at.clientWidth - at.scrollLeft : at.scrollLeft;
		if (room > 0) return true;
	}
	return false;
}

function blockSwipeNavigation(event: WheelEvent) {
	if (event.defaultPrevented) return;
	if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
	if (canScrollSideways(event.target, event.deltaX)) return;
	event.preventDefault();
}

export function useNoSwipeNavigation() {
	useEffect(() => {
		window.addEventListener("wheel", blockSwipeNavigation, { passive: false });
		return () => window.removeEventListener("wheel", blockSwipeNavigation);
	}, []);
}
