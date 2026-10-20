import { describe, expect, it } from "vitest";
import {
	fileContext,
	memorySource,
	permissionRules,
	preferencesSource,
	settingsSource,
	withoutRule,
} from "../src/lib/files.ts";

describe("memorySource", () => {
	it("writes a bare memory as the remember call that stores it", () => {
		expect(memorySource({ key: "tone", body: '"be brief"', links: [] })).toBe(
			'(memory/remember "tone"\n  "be brief")',
		);
	});

	it("carries the trigger as a form and the links as keys", () => {
		expect(
			memorySource({
				key: "retry",
				body: "(retry 3)",
				on: '(error "timeout")',
				links: [
					{ key: "net", weight: 0.4 },
					{ key: 'say "hi"', weight: 1 },
				],
			}),
		).toBe(
			'(memory/remember "retry"\n  (retry 3)\n  :on (error "timeout")\n  :links ("net" "say \\"hi\\""))',
		);
	});
});

describe("preferencesSource", () => {
	it("names the theme, the font, every toggle, the sidebar order and what it hides", () => {
		expect(
			preferencesSource({
				theme: "dusk",
				font: "mono",
				channels: { lisp: false, thinking: true },
				metadata: { tokens: true },
				input: { lisp: true },
				sidebar: ["README.md", "home"],
				hidden: ["tests"],
				motion: "lift",
			}),
		).toBe(
			'(preferences :theme "dusk"\n  :font "mono"\n  :channels (:lisp nil :thinking t)\n  :metadata (:tokens t)\n  :input (:lisp t)\n  :sidebar ("README.md" "home")\n  :hidden ("tests")\n  :motion "lift")',
		);
	});
});

describe("settingsSource", () => {
	it("names the workspace and its model", () => {
		expect(
			settingsSource(
				{ name: "personal" },
				{ provider: "anthropic", model: "claude-opus-5-5" },
			),
		).toBe('(settings :name "personal"\n  :model "anthropic/claude-opus-5-5")');
	});
});

describe("fileContext", () => {
	it("opens with the path and the source fenced as lisp", () => {
		expect(
			fileContext(
				{ path: "permissions.ptc", source: "(permission/default ask)" },
				"allow car",
			),
		).toBe(
			"about `permissions.ptc`:\n```lisp\n(permission/default ask)\n```\n\nallow car",
		);
	});

	it("fences a markdown file as markdown", () => {
		expect(
			fileContext(
				{ path: "README.md", source: "# notes", language: "markdown" },
				"tidy it",
			),
		).toBe("about `README.md`:\n```markdown\n# notes\n```\n\ntidy it");
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
