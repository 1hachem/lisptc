// @vitest-environment happy-dom
import { ANCHOR_IDS, PAGE_IDS } from "@repo/ui-catalog";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it } from "vitest";
import { useAnchor, useAnchorElement } from "../src/lib/anchors.ts";
import { panelTab } from "../src/lib/panel-ops.ts";

beforeAll(() => {
	(
		globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
	).IS_REACT_ACT_ENVIRONMENT = true;
});

let seen: HTMLElement | undefined;

function Settings({ shown }: { shown: boolean }) {
	const anchor = useAnchor<HTMLButtonElement>("settings");
	seen = useAnchorElement("settings");
	return shown ? <button ref={anchor} type="button" /> : null;
}

describe("an anchor", () => {
	it("marks the element it is on and drops it on unmount", () => {
		const host = document.createElement("div");
		const root = createRoot(host);
		act(() => root.render(<Settings shown />));
		expect(host.querySelector('[data-anchor="settings"]')).not.toBeNull();
		expect(seen).toBe(host.querySelector("button"));
		act(() => root.render(<Settings shown={false} />));
		expect(seen).toBeUndefined();
		act(() => root.unmount());
	});

	it("opens every catalog page under the tab id the agent names", () => {
		expect(ANCHOR_IDS.length).toBeGreaterThan(0);
		for (const page of PAGE_IDS)
			expect(panelTab({ kind: "page", page, title: page }).id).toBe(
				`page:${page}`,
			);
	});
});
