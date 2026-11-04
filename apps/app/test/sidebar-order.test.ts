import { describe, expect, it } from "vitest";
import {
	currentNames,
	RIGHT_BY_DEFAULT,
	SIDEBAR_ENTRIES,
	shownEntries,
	sidebarSides,
	toggledEntry,
	withHiddenSides,
} from "../src/lib/sidebar-order.ts";

describe("splitting the entries between the two sidebars", () => {
	it("puts the agent's own folders on the right when nothing is stored", () => {
		const sides = sidebarSides(undefined, undefined);
		expect(sides.right).toEqual([
			"memories",
			"permissions",
			"sub-agents",
			"triggers",
			"tasks",
			"ui",
			"tests",
		]);
		expect(sides.left).toEqual(
			SIDEBAR_ENTRIES.filter((name) => !RIGHT_BY_DEFAULT.includes(name)),
		);
	});

	it("moves the default right entries out of an order stored before there were two", () => {
		const sides = sidebarSides(["tests", "README.md", "chat"], undefined);
		expect(sides.left.slice(0, 2)).toEqual(["README.md", "chat"]);
		expect(sides.left).not.toContain("tests");
		expect(sides.right).toContain("tests");
	});

	it("keeps each stored side in its order, the right winning an entry named in both", () => {
		const sides = sidebarSides(["chat", "tests"], ["home", "tests"]);
		expect(sides.left[0]).toBe("chat");
		expect(sides.left).not.toContain("tests");
		expect(sides.right.slice(0, 2)).toEqual(["home", "tests"]);
	});

	it("places an entry neither side names on its default side", () => {
		const sides = sidebarSides(["chat"], ["home"]);
		expect(sides.right).toEqual(["home", ...RIGHT_BY_DEFAULT]);
		expect(sides.left).toContain("README.md");
		expect([...sides.left, ...sides.right].sort()).toEqual(
			[...SIDEBAR_ENTRIES].sort(),
		);
	});

	it("drops repeats and entries the sidebar no longer has", () => {
		const sides = sidebarSides(["gone", "chat", "chat"], ["gone"]);
		expect(sides.left[0]).toBe("chat");
		expect(sides.left.filter((name) => name === "chat")).toHaveLength(1);
		expect(sides.right).toEqual([...RIGHT_BY_DEFAULT]);
	});
});

describe("hidden entries", () => {
	it("leaves the hidden entries out of what a sidebar shows", () => {
		const shown = shownEntries(["README.md", "chat", "tests"], ["tests"]);
		expect(shown).toEqual(["README.md", "chat"]);
	});

	it("keeps a hidden entry on its side after the shown ones move", () => {
		const previous = {
			left: ["chat" as const, "bin" as const],
			right: ["tests" as const, "ui" as const],
		};
		expect(
			withHiddenSides({ left: [], right: ["chat", "tests"] }, previous),
		).toEqual({ left: ["bin"], right: ["chat", "tests", "ui"] });
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
		expect(
			sidebarSides(["preferences.ptc", "chat"], []).left.slice(0, 2),
		).toEqual(["preferences", "chat"]);
		expect(shownEntries(["settings"], ["settings.ptc"])).toEqual([]);
		expect(toggledEntry(["settings.ptc"], "settings")).toEqual([]);
		expect(currentNames(["settings.ptc", "tests"])).toEqual([
			"settings",
			"tests",
		]);
	});
});
