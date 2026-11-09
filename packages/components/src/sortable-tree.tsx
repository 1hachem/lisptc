"use client";

import { createContext, useContext, useSyncExternalStore } from "react";

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

export const EntryDragged = createContext(false);

export function useEntryDragged() {
	return useContext(EntryDragged);
}

export function moved<Id extends string>(
	order: readonly Id[],
	active: Id,
	over: Id | undefined,
): Id[] | undefined {
	if (over === undefined || active === over) return undefined;
	const from = order.indexOf(active);
	const to = order.indexOf(over);
	if (from < 0 || to < 0) return undefined;
	const next = [...order];
	next.splice(from, 1);
	next.splice(to, 0, active);
	return next;
}

export function awaitingOrder<Id extends string>(
	order: readonly Id[],
	dropped: { next: readonly Id[]; over: readonly Id[] } | undefined,
): readonly Id[] {
	return dropped && dropped.over.join("\0") === order.join("\0")
		? dropped.next
		: order;
}

function subscribeReducedMotion(onChange: () => void) {
	const query = window.matchMedia(REDUCED_MOTION);
	query.addEventListener("change", onChange);
	return () => query.removeEventListener("change", onChange);
}

export function usePrefersReducedMotion() {
	return useSyncExternalStore(
		subscribeReducedMotion,
		() => window.matchMedia(REDUCED_MOTION).matches,
		() => false,
	);
}
