import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		coverage: {
			include: ["src/**"],
			reporter: ["json", "text-summary"],
			thresholds: {
				statements: 98,
				branches: 96,
				functions: 100,
				lines: 98,
			},
		},
		include: ["test/**/*.test.ts"],
	},
});
