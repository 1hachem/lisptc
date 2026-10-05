import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		coverage: {
			include: ["src/**"],
			reporter: ["json", "text-summary"],
			thresholds: {
				statements: 76,
				branches: 85,
				functions: 81,
				lines: 76,
			},
		},
		include: ["test/**/*.test.ts"],
	},
});
