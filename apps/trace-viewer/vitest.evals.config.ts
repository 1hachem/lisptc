import { evalConcurrency } from "@repo/evals/targets";
import { defineConfig } from "vitest/config";

const concurrency = evalConcurrency();

export default defineConfig({
	test: {
		environment: "node",
		include: ["evals/**/*.eval.ts"],
		globalSetup: ["@repo/evals/global-setup"],
		testTimeout: 300_000,
		hookTimeout: 60_000,
		fileParallelism: concurrency > 1,
		maxWorkers: concurrency,
		maxConcurrency: concurrency,
		sequence: { concurrent: concurrency > 1 },
		retry: 0,
	},
});
