import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "edge-runtime",
		testTimeout: 30_000,
		hookTimeout: 30_000,
		include: ["test/**/*.test.ts"],
		server: { deps: { inline: ["convex-test"] } },
	},
});
