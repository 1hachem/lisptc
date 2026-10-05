import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		coverage: {
			include: ["src/**"],
			reporter: ["json", "text-summary"],
			thresholds: {
				statements: 82,
				branches: 81,
				functions: 86,
				lines: 82,
			},
		},
		include: ["test/**/*.test.ts"],
	},
});
