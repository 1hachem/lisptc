import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		include: ["test/calibration/**/*.calibration.ts"],
		testTimeout: 180_000,
	},
});
