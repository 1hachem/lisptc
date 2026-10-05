import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		coverage: {
			include: ["src/**"],
			reporter: ["json", "text-summary"],
		},
		include: ["test/**/*.test.ts"],
		setupFiles: ["./test/setup-env.ts"],
	},
});
