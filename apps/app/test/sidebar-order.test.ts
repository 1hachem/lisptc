import { describe, expect, it } from "vitest";
import {
	SIDEBAR_ENTRIES,
	shownEntries,
	sidebarOrder,
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

	it("drops repeats and entries the sidebar no longer has", () => {
		expect(sidebarOrder(["gone", "tasks", "tasks"])[0]).toBe("tasks");
		expect(sidebarOrder(["gone"])).toEqual([...SIDEBAR_ENTRIES]);
	});
});

describe("hidden entries", () => {
	const order = sidebarOrder(["README.md", "chat", "tests", "home"]);

	it("leaves the hidden entries out of what the sidebar shows", () => {
		const shown = shownEntries(order, ["tests", "sub-agents"]);
		expect(shown.slice(0, 3)).toEqual(["README.md", "chat", "home"]);
		expect(shown).not.toContain("tests");
		expect(shown).not.toContain("sub-agents");
	});

	it("keeps the hidden entries in the stored order after a drag", () => {
		const next = withHidden(["chat", "README.md", "home"], order.slice(0, 4));
		expect(next).toEqual(["chat", "README.md", "home", "tests"]);
	});
});
