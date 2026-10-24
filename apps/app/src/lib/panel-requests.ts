import { useEffect } from "react";
import { type PanelContent, type PanelOp, panelTab } from "./panel-ops.ts";

const listeners = new Set<(ops: readonly PanelOp[]) => void>();

function requestPanelOps(ops: readonly PanelOp[]): void {
	for (const listen of listeners) listen(ops);
}

export function requestPanel(content: PanelContent): void {
	requestPanelOps([
		{ op: "open", tab: panelTab(content).id, split: "here", content },
	]);
}

export function requestPanelClosed(content: PanelContent): void {
	requestPanelOps([{ op: "close", tab: panelTab(content).id }]);
}

export function usePanelRequests(apply: (ops: readonly PanelOp[]) => void) {
	useEffect(() => {
		listeners.add(apply);
		return () => {
			listeners.delete(apply);
		};
	}, [apply]);
}
