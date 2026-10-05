import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		include: ["src/**/*.test.{ts,tsx}"],
		coverage: {
			include: ["src/**/*.{ts,tsx}", "!src/**/*.test.{ts,tsx}"],
			reporter: ["json", "text-summary"],
		},
	},
});
