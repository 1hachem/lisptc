import { describe, expect, it } from "vitest";
import type { PanelContent } from "../src/lib/panel-ops.ts";
import { panelAt, panelPath } from "../src/lib/panel-paths.ts";

describe("panel paths", () => {
	it.each<[PanelContent, string]>([
		[{ kind: "chat", chatId: null, title: "new chat" }, ""],
		[{ kind: "chat", chatId: "abc", title: "chat" }, "chat/abc"],
		[{ kind: "trace", chatId: "abc", title: "trace" }, "trace/abc"],
		[
			{ kind: "file", folder: "knowledge", name: "q3 plan.pdf" },
			"knowledge/q3 plan.pdf",
		],
		[
			{ kind: "file", folder: "attachments", name: "a.png" },
			"attachments/a.png",
		],
		[
			{ kind: "source", folder: "sub-agents", name: "researcher.ptc" },
			"sub-agents/researcher.ptc",
		],
		[
			{ kind: "page", page: "memory", id: "tone", title: "memories/tone" },
			"memories/tone",
		],
		[
			{ kind: "page", page: "permission", id: "2", title: "permissions/2" },
			"permissions/2",
		],
		[
			{ kind: "page", page: "bin", id: "old.md", title: "bin/old.md" },
			"bin/old.md",
		],
		[{ kind: "page", page: "readme", title: "README.md" }, "readme"],
		[{ kind: "page", page: "settings", title: "settings.ptc" }, "settings"],
		[
			{ kind: "page", page: "preferences", title: "preferences.ptc" },
			"preferences",
		],
		[{ kind: "page", page: "account", title: "account" }, "account"],
	])("round-trips %o through %s", (content, path) => {
		expect(panelPath(content)).toBe(path);
		expect(panelAt(path)).toEqual(content);
	});

	it("names pages in the plural the tree uses, not the tab kind", () => {
		expect(
			panelPath({ kind: "page", page: "memory", id: "k", title: "" }),
		).toBe("memories/k");
	});

	it("has no path for a drawn view", () => {
		expect(
			panelPath({ kind: "view", title: "chart", node: {} }),
		).toBeUndefined();
	});

	it("ignores stray slashes and refuses what it does not know", () => {
		expect(panelAt("/knowledge/a.md/")).toEqual({
			kind: "file",
			folder: "knowledge",
			name: "a.md",
		});
		expect(panelAt("nowhere/x")).toBeUndefined();
		expect(panelAt("memories")).toBeUndefined();
		expect(panelAt("readme/extra")).toBeUndefined();
	});
});
