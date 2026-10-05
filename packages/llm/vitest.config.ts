import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		coverage: {
			include: ["src/**"],
			reporter: ["json", "text-summary"],
			thresholds: {
				statements: 92,
				branches: 81,
				functions: 84,
				lines: 92,
			},
		},
		include: ["test/**/*.test.ts"],
	},
});
