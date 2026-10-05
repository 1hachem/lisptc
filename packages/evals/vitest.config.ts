import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		coverage: {
			include: ["src/**"],
			reporter: ["json", "text-summary"],
			thresholds: {
				statements: 49,
				branches: 81,
				functions: 80,
				lines: 49,
			},
		},
		include: ["test/**/*.test.ts"],
		setupFiles: ["./test/setup-env.ts"],
	},
});
