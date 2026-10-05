import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		coverage: {
			include: ["src/**"],
			reporter: ["json", "text-summary"],
			thresholds: {
				statements: 56,
				branches: 89,
				functions: 82,
				lines: 56,
			},
		},
		include: ["test/**/*.test.ts"],
	},
});
