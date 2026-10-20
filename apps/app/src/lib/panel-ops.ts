import {
	closeTab,
	focusTab,
	openTab,
	type Placement,
	type SplitLayout,
} from "@repo/components";

export type Folder = "attachments" | "knowledge";

export type PanelContent =
	| { kind: "file"; folder: Folder; name: string }
	| { kind: "view"; title: string; node: unknown };

export type PanelLayout = SplitLayout<PanelContent>;

export type Split = "here" | "right" | "down";

export type PanelOp =
	| { op: "open"; tab: string; split: Split; content: PanelContent }
	| { op: "close"; tab: string }
	| { op: "focus"; tab: string };

const PLACEMENT: Record<Split, Placement> = {
	here: "focused",
	right: "right",
	down: "down",
};

export function fileTab(folder: Folder, name: string): string {
	return `file:${folder}/${name}`;
}

function record(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function contentOf(value: unknown): PanelContent | undefined {
	const content = record(value);
	if (
		content?.kind === "file" &&
		(content.folder === "attachments" || content.folder === "knowledge") &&
		typeof content.name === "string"
	)
		return { kind: "file", folder: content.folder, name: content.name };
	if (content?.kind === "view" && typeof content.title === "string")
		return { kind: "view", title: content.title, node: content.node };
	return undefined;
}

export function toPanelOps(value: unknown): PanelOp[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((item): PanelOp[] => {
		const op = record(item);
		if (typeof op?.tab !== "string") return [];
		if (op.op === "close" || op.op === "focus")
			return [{ op: op.op, tab: op.tab }];
		const content = contentOf(op.content);
		if (op.op !== "open" || content === undefined) return [];
		const split =
			op.split === "right" || op.split === "down" ? op.split : "here";
		return [{ op: "open", tab: op.tab, split, content }];
	});
}

export function applyPanelOps(
	layout: PanelLayout,
	ops: readonly PanelOp[],
): PanelLayout {
	return ops.reduce((current, op) => {
		if (op.op === "close") return closeTab(current, op.tab);
		if (op.op === "focus") return focusTab(current, op.tab);
		return openTab(
			current,
			{ id: op.tab, content: op.content },
			PLACEMENT[op.split],
		);
	}, layout);
}
