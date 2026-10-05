import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
	},
	test: {
		environment: "node",
		include: ["evals/harness/**/*.test.ts", "test/**/*.test.ts"],
		setupFiles: ["./evals/harness/setup-env.ts"],
		coverage: {
			include: ["src/**"],
			reporter: ["json", "text-summary"],
			thresholds: {
				statements: 4,
				branches: 68,
				functions: 38,
				lines: 4,
			},
		},
	},
});
