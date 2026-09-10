import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		include: ["evals/**/*.eval.ts"],
		testTimeout: 300_000,
		hookTimeout: 60_000,
		fileParallelism: false,
		retry: 0,
	},
});
