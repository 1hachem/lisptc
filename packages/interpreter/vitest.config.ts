import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		include: ["test/**/*.test.ts"],
		setupFiles: ["./test/setup-env.ts"],
		testTimeout: 60_000,
		coverage: {
			include: ["src/**"],
			reporter: ["json", "text-summary"],
		},
	},
});
