import { useEffect } from "react";
import type { PanelContent } from "./panel-ops.ts";

const listeners = new Set<(content: PanelContent) => void>();

export function requestPanel(content: PanelContent): void {
	for (const listen of listeners) listen(content);
}

export function usePanelRequests(open: (content: PanelContent) => void) {
	useEffect(() => {
		listeners.add(open);
		return () => {
			listeners.delete(open);
		};
	}, [open]);
}
