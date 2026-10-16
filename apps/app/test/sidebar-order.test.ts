import { describe, expect, it } from "vitest";
import { SIDEBAR_ENTRIES, sidebarOrder } from "../src/lib/sidebar-order.ts";

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
