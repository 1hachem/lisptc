import {
	allTabs,
	closeTab,
	focusTab,
	openTab,
	type Placement,
	paneOf,
	type SplitLayout,
	type Tab,
} from "./split-layout.ts";

export type Split = "here" | "right" | "down";

export type PanelOp<C> =
	| { op: "open"; tab: string; split: Split; content: C }
	| { op: "close"; tab: string }
	| { op: "focus"; tab: string };

interface Kinded {
	kind: string;
}

const PLACEMENT: Record<Split, Placement> = {
	here: "focused",
	right: "right",
	down: "down",
};

export function focusedTab<C>(layout: SplitLayout<C>): Tab<C> | undefined {
	return allTabs(layout).find((tab) => {
		const pane = paneOf(layout, tab.id);
		return pane?.id === layout.focused && pane.active === tab.id;
	});
}

function placed<C extends Kinded>(
	layout: SplitLayout<C>,
	split: Split,
	content: C,
): Placement {
	if (split !== "here") return PLACEMENT[split];
	return content.kind !== "chat" && focusedTab(layout)?.content.kind === "chat"
		? "right"
		: "focused";
}

export function applyPanelOps<C extends Kinded>(
	layout: SplitLayout<C>,
	ops: readonly PanelOp<C>[],
): SplitLayout<C> {
	return ops.reduce((current, op) => {
		if (op.op === "close") return closeTab(current, op.tab);
		if (op.op === "focus") return focusTab(current, op.tab);
		return openTab(
			current,
			{ id: op.tab, content: op.content },
			placed(current, op.split, op.content),
		);
	}, layout);
}
