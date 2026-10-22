import { describe, expect, it } from "vitest";
import {
	SIDEBAR_ENTRIES,
	shownEntries,
	sidebarOrder,
	toggledHidden,
	withHidden,
} from "../src/lib/sidebar-order.ts";

describe("sidebarOrder", () => {
	it("falls back to the default order when nothing is stored", () => {
		expect(sidebarOrder(undefined)).toEqual([...SIDEBAR_ENTRIES]);
	});

	it("keeps the stored order and appends the entries it does not name", () => {
		const order = sidebarOrder(["README.md", "chat"]);
		expect(order.slice(0, 3)).toEqual(["README.md", "chat", "home"]);
		expect(order).toHaveLength(SIDEBAR_ENTRIES.length);
	});

	it("keeps a renamed entry where the user put it", () => {
		expect(sidebarOrder(["README.md", "agents"]).slice(0, 2)).toEqual([
			"README.md",
			"sub-agents",
		]);
	});

	it("drops repeats and entries the sidebar no longer has", () => {
		expect(sidebarOrder(["gone", "tasks", "tasks"])[0]).toBe("tasks");
		expect(sidebarOrder(["gone"])).toEqual([...SIDEBAR_ENTRIES]);
	});
});

describe("hidden entries", () => {
	const order = sidebarOrder(["README.md", "chat", "tests", "home"]);

	it("leaves the hidden entries out of what the sidebar shows", () => {
		const shown = shownEntries(order, ["tests", "agents"]);
		expect(shown.slice(0, 3)).toEqual(["README.md", "chat", "home"]);
		expect(shown).not.toContain("tests");
		expect(shown).not.toContain("sub-agents");
	});

	it("keeps the hidden entries in the stored order after a drag", () => {
		const next = withHidden(["chat", "README.md", "home"], order.slice(0, 4));
		expect(next).toEqual(["chat", "README.md", "home", "tests"]);
	});

	it("hides a shown entry and shows a hidden one", () => {
		expect(toggledHidden(["memories"], "tests")).toEqual(["memories", "tests"]);
		expect(toggledHidden(["memories", "tests"], "memories")).toEqual(["tests"]);
		expect(toggledHidden(undefined, "ui")).toEqual(["ui"]);
	});

	it("shows a renamed entry and drops names the sidebar no longer has", () => {
		expect(toggledHidden(["agents", "gone"], "sub-agents")).toEqual([]);
	});
});
