import { ANCHOR_IDS, anchors } from "@repo/ui-catalog";
import { describe, expect, it } from "vitest";
import type { PanelContent } from "../src/lib/panel-ops.ts";
import {
	CALLOUT_GAP,
	calloutPlacement,
	type Revealer,
	reveal,
} from "../src/lib/tour-layout.ts";

const view = { width: 1000, height: 800 };
const size = { width: 200, height: 100 };

describe("the tour callout", () => {
	it("sits to the right of a box with room there", () => {
		const box = { top: 300, left: 100, width: 100, height: 40 };
		expect(calloutPlacement(box, size, view)).toEqual({
			side: "right",
			top: 270,
			left: 200 + CALLOUT_GAP,
		});
	});

	it("flips to the left near the right edge", () => {
		const box = { top: 300, left: 850, width: 100, height: 40 };
		expect(calloutPlacement(box, size, view)).toMatchObject({
			side: "left",
			left: 850 - CALLOUT_GAP - 200,
		});
	});

	it("goes above a box as wide as the screen at the bottom", () => {
		const box = { top: 720, left: 0, width: 1000, height: 60 };
		const placed = calloutPlacement(box, size, view);
		expect(placed.side).toBe("above");
		expect(placed.top + size.height).toBeLessThanOrEqual(box.top);
	});

	it("never overlaps the box it points at", () => {
		const box = { top: 10, left: 10, width: 300, height: 40 };
		const placed = calloutPlacement(box, size, view);
		const apart =
			placed.left >= box.left + box.width ||
			placed.left + size.width <= box.left ||
			placed.top >= box.top + box.height ||
			placed.top + size.height <= box.top;
		expect(apart).toBe(true);
	});
});

describe("revealing an anchor", () => {
	function recorder() {
		const calls: string[] = [];
		const revealer: Revealer = {
			openSidebar: () => calls.push("sidebar"),
			openRight: () => calls.push("right"),
			openChat: () => calls.push("chat"),
			openFolder: (folder) => calls.push(`folder:${folder}`),
			openPage: (content: PanelContent) =>
				calls.push(`page:${content.kind === "page" ? content.page : "?"}`),
		};
		return { calls, revealer };
	}

	it("does nothing for one always on screen", () => {
		const { calls, revealer } = recorder();
		reveal({ kind: "shell" }, revealer);
		expect(calls).toEqual([]);
	});

	it("opens the sidebar and the folder for one inside a folder", () => {
		const { calls, revealer } = recorder();
		reveal({ kind: "folder", folder: "knowledge" }, revealer);
		expect(calls).toEqual(["sidebar", "folder:knowledge"]);
	});

	it("opens what hides one in the sidebar, the right sidebar or a chat", () => {
		const { calls, revealer } = recorder();
		reveal({ kind: "sidebar" }, revealer);
		reveal({ kind: "right" }, revealer);
		reveal({ kind: "chat" }, revealer);
		expect(calls).toEqual(["sidebar", "right", "chat"]);
	});

	it("opens the page for one on a page", () => {
		const { calls, revealer } = recorder();
		reveal({ kind: "page", page: "settings" }, revealer);
		expect(calls).toEqual(["page:settings"]);
	});

	it("reveals every anchor the catalog holds", () => {
		for (const id of ANCHOR_IDS) {
			const { revealer } = recorder();
			expect(() => reveal(anchors[id].location, revealer)).not.toThrow();
		}
	});
});
