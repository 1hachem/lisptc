import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		include: ["test/**/*.test.ts"],
		coverage: {
			include: ["src/**"],
			reporter: ["json", "text-summary"],
			thresholds: {
				statements: 100,
				branches: 88,
				functions: 100,
				lines: 100,
			},
		},
	},
});
