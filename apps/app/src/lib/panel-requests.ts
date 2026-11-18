import type { PanelOp } from "@repo/shared/panel-layout";
import { useEffect } from "react";
import { type PanelContent, panelTab } from "./panel-ops.ts";

const listeners = new Set<(ops: readonly PanelOp<PanelContent>[]) => void>();

export function requestPanelOps(ops: readonly PanelOp<PanelContent>[]): void {
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

export function usePanelRequests(
	apply: (ops: readonly PanelOp<PanelContent>[]) => void,
) {
	useEffect(() => {
		listeners.add(apply);
		return () => {
			listeners.delete(apply);
		};
	}, [apply]);
}
