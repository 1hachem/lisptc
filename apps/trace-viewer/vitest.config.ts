import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		include: ["evals/harness/**/*.test.ts"],
		setupFiles: ["./evals/harness/setup-env.ts"],
	},
});
