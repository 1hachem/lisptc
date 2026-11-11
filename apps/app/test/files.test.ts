import { describe, expect, it } from "vitest";
import {
	fileContext,
	onboardingSource,
	permissionRules,
	withoutRule,
} from "../src/lib/files.ts";

describe("onboardingSource", () => {
	it("writes an onboarding as the create call that saves it", () => {
		expect(
			onboardingSource({
				name: "welcome",
				about: "first look",
				script: '(ui/tour "welcome" (quote (:say "hi")))',
			}),
		).toBe(
			'(onboarding/create "welcome"\n  \'(ui/tour "welcome" (quote (:say "hi")))\n  :about "first look")',
		);
	});

	it("leaves out an empty line", () => {
		expect(
			onboardingSource({ name: "tips", about: "", script: "(+ 1 2)" }),
		).toBe('(onboarding/create "tips"\n  \'(+ 1 2))');
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
