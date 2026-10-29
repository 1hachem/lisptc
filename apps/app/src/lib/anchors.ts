import type { AnchorId } from "@repo/ui-catalog";
import { useCallback, useSyncExternalStore } from "react";

const mounted = new Map<AnchorId, HTMLElement>();

const listeners = new Set<() => void>();

function changed(): void {
	for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function useAnchorElement(
	id: AnchorId | undefined,
): HTMLElement | undefined {
	return useSyncExternalStore(
		subscribe,
		() => (id === undefined ? undefined : mounted.get(id)),
		() => undefined,
	);
}

export function useAnchor<E extends HTMLElement>(
	id: AnchorId,
): (element: E | null) => () => void {
	return useCallback(
		(element: E | null) => {
			if (element === null) return () => {};
			element.dataset.anchor = id;
			mounted.set(id, element);
			changed();
			return () => {
				if (mounted.get(id) !== element) return;
				mounted.delete(id);
				changed();
			};
		},
		[id],
	);
}
