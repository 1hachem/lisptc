import type { Awaitable } from "@repo/shared/host";
import type { FOLDERS } from "@repo/ui-catalog";
import type { UiValue } from "./view.ts";

export type Folder = (typeof FOLDERS)[number];

export const SPLITS = ["here", "right", "down"] as const;

export type Split = (typeof SPLITS)[number];

export type PanelContent =
	| { kind: "file"; folder: Folder; name: string }
	| { kind: "view"; title: string; node: UiValue };

export type PanelOp =
	| { op: "open"; tab: string; split: Split; content: PanelContent }
	| { op: "close"; tab: string }
	| { op: "focus"; tab: string };

export interface PanelStore {
	apply(ops: readonly PanelOp[]): Awaitable<void>;
	tabs(): Awaitable<PanelTab[]>;
}

export function fileTab(folder: Folder, name: string): string {
	return `file:${folder}/${name}`;
}

export function viewTab(title: string): string {
	return `view:${title}`;
}

export interface PanelTab {
	id: string;
	kind: string;
	title: string;
	shown: boolean;
	focused: boolean;
}
