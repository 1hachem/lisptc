import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		coverage: {
			include: ["src/**"],
			reporter: ["json", "text-summary"],
			thresholds: {
				statements: 80,
				branches: 86,
				functions: 81,
				lines: 80,
			},
		},
		include: ["test/**/*.test.ts"],
	},
});
