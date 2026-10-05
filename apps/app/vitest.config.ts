import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		coverage: {
			include: ["src/**"],
			reporter: ["json", "text-summary"],
			thresholds: {
				statements: 18,
				branches: 66,
				functions: 34,
				lines: 18,
			},
		},
		include: ["test/**/*.test.{ts,tsx}"],
	},
});
