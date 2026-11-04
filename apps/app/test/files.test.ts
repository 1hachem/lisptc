import type { Id } from "@repo/backend/dataModel";
import { str } from "@repo/interpreter/print";
import { Reader } from "@repo/interpreter/reader";
import { describe, expect, it } from "vitest";
import {
	fileContext,
	memorySource,
	permissionRules,
	preferencesSource,
	settingsSource,
	withoutRule,
} from "../src/lib/files.ts";

function form(source: string): string {
	const reader = new Reader();
	reader.push(source);
	return str(reader.read());
}

describe("memorySource", () => {
	it("writes a bare memory as the remember call that stores it", () => {
		expect(
			form(memorySource({ key: "tone", body: '"be brief"', links: [] })),
		).toBe(form('(memory/remember "tone" "be brief")'));
	});

	it("carries the trigger as a form and the links as keys", () => {
		expect(
			form(
				memorySource({
					key: "retry",
					body: "(retry 3)",
					on: '(error "timeout")',
					links: [
						{ key: "net", weight: 0.4 },
						{ key: 'say "hi"', weight: 1 },
					],
				}),
			),
		).toBe(
			form(
				'(memory/remember "retry" (retry 3) :on (error "timeout") :links ("net" "say \\"hi\\""))',
			),
		);
	});
});

describe("preferencesSource", () => {
	it("names the font, every toggle, the sidebar order and what it hides", () => {
		expect(
			form(
				preferencesSource({
					font: "mono",
					metadata: { tokens: true },
					input: { lisp: true },
					sidebar: ["README.md", "home"],
					hidden: ["tests"],
					motion: "lift",
					panelMotion: false,
					traceBesideChat: true,
					traceLink: false,
				}),
			),
		).toBe(
			form(
				'(preferences :font "mono" :metadata (:tokens t) :input (:lisp t) :sidebar ("README.md" "home") :hidden ("tests") :motion "lift" :panel-motion nil :trace-beside-chat t :trace-link nil)',
			),
		);
	});
});

describe("settingsSource", () => {
	it("names the workspace, its model, its icon and its theme", () => {
		expect(
			form(
				settingsSource(
					{ _id: "w1" as Id<"workspaces">, name: "personal", icon: "rocket" },
					{ provider: "anthropic", model: "claude-opus-5-5" },
					"borland",
				),
			),
		).toBe(
			form(
				'(settings :name "personal" :model "anthropic/claude-opus-5-5" :icon "rocket" :theme "borland")',
			),
		);
	});
});

describe("fileContext", () => {
	it("opens with the path and the source fenced as lisp", () => {
		const context = fileContext(
			{ path: "permissions.ptc", source: "(permission/default ask)" },
			"allow car",
		);
		expect(context).toContain("permissions.ptc");
		expect(context).toContain("```lisp\n(permission/default ask)\n```");
		expect(context).toContain("allow car");
	});

	it("fences a markdown file as markdown", () => {
		const context = fileContext(
			{ path: "README.md", source: "# notes", language: "markdown" },
			"tidy it",
		);
		expect(context).toContain("README.md");
		expect(context).toContain("```markdown\n# notes\n```");
		expect(context).toContain("tidy it");
	});
});

describe("permissionRules", () => {
	const source =
		'(permission/default ask)\n(permission/allow + - car)\n(permission/deny eval :reason "no")\n';

	it("names each top-level rule by its verb and arguments", () => {
		expect(permissionRules(source).map((rule) => rule.name)).toEqual([
			"default ask",
			"allow + - car",
			'deny eval :reason "no"',
		]);
	});

	it("drops one rule and keeps the rest of the source as written", () => {
		const [, allow] = permissionRules(source);
		expect(allow && withoutRule(source, allow)).toBe(
			'(permission/default ask)\n(permission/deny eval :reason "no")\n',
		);
	});
});
