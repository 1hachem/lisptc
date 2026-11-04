import { describe, expect, it } from "vitest";
import {
	currentNames,
	SIDEBAR_ENTRIES,
	shownEntries,
	sidebarOrder,
	toggledEntry,
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

describe("toggling an entry", () => {
	it("hides a shown entry and shows a hidden one", () => {
		expect(toggledEntry(["tests"], "bin")).toEqual(["tests", "bin"]);
		expect(toggledEntry(["tests", "bin"], "tests")).toEqual(["bin"]);
	});

	it("drops repeats and entries the sidebar no longer has", () => {
		expect(toggledEntry(["gone", "bin", "bin"], "ui")).toEqual(["bin", "ui"]);
		expect(toggledEntry(undefined, "home")).toEqual(["home"]);
	});
});

describe("entries saved under their old .ptc names", () => {
	it("keep their place and stay hidden under the new names", () => {
		expect(sidebarOrder(["preferences.ptc", "chat"]).slice(0, 2)).toEqual([
			"preferences",
			"chat",
		]);
		const order = sidebarOrder(undefined);
		expect(shownEntries(order, ["settings.ptc"])).not.toContain("settings");
		expect(toggledEntry(["settings.ptc"], "settings")).toEqual([]);
		expect(currentNames(["settings.ptc", "tests"])).toEqual([
			"settings",
			"tests",
		]);
	});
});
