import { useEffect } from "react";

type Fill = (target: Element, text: string) => void;

const listeners = new Set<Fill>();

export function requestComposerText(target: Element, text: string): void {
	for (const fill of listeners) fill(target, text);
}

export function useComposerRequests(fill: Fill) {
	useEffect(() => {
		listeners.add(fill);
		return () => {
			listeners.delete(fill);
		};
	}, [fill]);
}
