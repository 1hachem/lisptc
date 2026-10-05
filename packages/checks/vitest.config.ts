import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		coverage: {
			include: ["src/**"],
			reporter: ["json", "text-summary"],
			thresholds: {
				statements: 77,
				branches: 92,
				functions: 74,
				lines: 77,
			},
		},
		include: ["test/**/*.test.ts"],
	},
});
