import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "edge-runtime",
		include: ["test/**/*.test.ts"],
		server: { deps: { inline: ["convex-test"] } },
	},
});
