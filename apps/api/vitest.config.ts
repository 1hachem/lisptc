import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		include: ["test/**/*.test.ts"],
		coverage: {
			include: ["src/**"],
			reporter: ["json", "text-summary"],
			thresholds: {
				statements: 59,
				branches: 65,
				functions: 61,
				lines: 59,
			},
		},
	},
});
