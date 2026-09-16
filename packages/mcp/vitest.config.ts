import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		include: ["test/**/*.test.ts"],
		setupFiles: ["./test/setup-env.ts"],
		testTimeout: 20_000,
	},
});
