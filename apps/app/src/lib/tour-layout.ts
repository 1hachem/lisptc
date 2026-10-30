import {
	type AnchorLocation,
	type PageId,
	pages,
	type SidebarFolder,
} from "@repo/ui-catalog";
import type { PanelContent } from "./panel-ops.ts";

export interface Box {
	top: number;
	left: number;
	width: number;
	height: number;
}

export interface Size {
	width: number;
	height: number;
}

export type Side = "right" | "left" | "below" | "above";

export interface Placement {
	top: number;
	left: number;
	side: Side;
}

export const CALLOUT_GAP = 12;

const MARGIN = 8;

function clamp(value: number, low: number, high: number): number {
	return Math.max(low, Math.min(value, Math.max(low, high)));
}

function fits(side: Side, box: Box, size: Size, view: Size): boolean {
	switch (side) {
		case "right":
			return (
				box.left + box.width + CALLOUT_GAP + size.width + MARGIN <= view.width
			);
		case "left":
			return box.left - CALLOUT_GAP - size.width - MARGIN >= 0;
		case "below":
			return (
				box.top + box.height + CALLOUT_GAP + size.height + MARGIN <= view.height
			);
		case "above":
			return box.top - CALLOUT_GAP - size.height - MARGIN >= 0;
	}
}

const SIDES: readonly Side[] = ["right", "left", "below", "above"];

export function calloutPlacement(box: Box, size: Size, view: Size): Placement {
	const side = SIDES.find((at) => fits(at, box, size, view)) ?? "below";
	const across = clamp(
		box.top + box.height / 2 - size.height / 2,
		MARGIN,
		view.height - size.height - MARGIN,
	);
	const along = clamp(
		box.left + box.width / 2 - size.width / 2,
		MARGIN,
		view.width - size.width - MARGIN,
	);
	switch (side) {
		case "right":
			return { side, top: across, left: box.left + box.width + CALLOUT_GAP };
		case "left":
			return { side, top: across, left: box.left - CALLOUT_GAP - size.width };
		case "below":
			return {
				side,
				top: clamp(
					box.top + box.height + CALLOUT_GAP,
					MARGIN,
					view.height - size.height - MARGIN,
				),
				left: along,
			};
		case "above":
			return { side, top: box.top - CALLOUT_GAP - size.height, left: along };
	}
}

export function pageContent(page: PageId): PanelContent {
	return { kind: "page", page, title: pages[page].title };
}

export interface Revealer {
	openSidebar(): void;
	openRight(): void;
	openChat(): void;
	openFolder(folder: SidebarFolder): void;
	openPage(content: PanelContent): void;
}

export function reveal(location: AnchorLocation, revealer: Revealer): void {
	switch (location.kind) {
		case "shell":
			return;
		case "sidebar":
			revealer.openSidebar();
			return;
		case "right":
			revealer.openRight();
			return;
		case "chat":
			revealer.openChat();
			return;
		case "folder":
			revealer.openSidebar();
			revealer.openFolder(location.folder);
			return;
		case "page":
			revealer.openPage(pageContent(location.page));
	}
}
