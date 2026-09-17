import type { Plugin, UserConfig } from "@commitlint/types";

const bodyLines: Plugin = {
	rules: {
		"body-max-lines": ({ body }, _when, value) => {
			const max = typeof value === "number" ? value : 1;
			const lines = (body ?? "")
				.split("\n")
				.map((line) => line.trim())
				.filter(Boolean);
			return [
				lines.length <= max,
				`body must be at most ${max} line(s); prefer a title-only commit`,
			];
		},
	},
};

const Configuration: UserConfig = {
	extends: ["@commitlint/config-conventional"],
	plugins: [bodyLines],
	rules: {
		"body-leading-blank": [1, "always"],
		"body-max-line-length": [2, "always", 100],
		"body-max-lines": [2, "always", 1],
		"footer-leading-blank": [1, "always"],
		"footer-max-line-length": [2, "always", 100],
		"header-max-length": [2, "always", 100],
		"scope-case": [2, "always", "lower-case"],
		"subject-case": [
			2,
			"never",
			["sentence-case", "start-case", "pascal-case", "upper-case"],
		],
		"subject-empty": [2, "never"],
		"subject-full-stop": [2, "never", "."],
		"type-case": [2, "always", "lower-case"],
		"type-empty": [2, "never"],
		"type-enum": [
			2,
			"always",
			[
				"wip",
				"build",
				"chore",
				"ci",
				"docs",
				"eval",
				"feat",
				"fix",
				"perf",
				"refactor",
				"revert",
				"style",
				"test",
			],
		],
	},
};

export default Configuration;
