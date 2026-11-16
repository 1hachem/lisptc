import { describe, expect, it } from "vitest";
import { fileContext, permissionRules, withoutRule } from "../src/lib/files.ts";

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
