import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		coverage: {
			include: ["src/**"],
			reporter: ["json", "text-summary"],
			thresholds: {
				statements: 26,
				branches: 42,
				functions: 30,
				lines: 26,
			},
		},
		include: ["test/**/*.test.ts"],
	},
});
