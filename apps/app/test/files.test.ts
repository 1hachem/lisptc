import { describe, expect, it } from "vitest";
import {
	fileContext,
	memorySource,
	permissionRules,
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
