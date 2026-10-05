import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		include: ["test/**/*.test.ts"],
		setupFiles: ["./test/setup-env.ts"],
		testTimeout: 20_000,
		coverage: {
			include: ["src/**"],
			reporter: ["json", "text-summary"],
			thresholds: {
				statements: 80,
				branches: 69,
				functions: 86,
				lines: 80,
			},
		},
	},
});
