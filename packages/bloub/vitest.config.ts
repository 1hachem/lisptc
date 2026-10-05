import { configDefaults, defineConfig } from "vitest/config";

// biome-ignore lint/style/noProcessEnv: runner config, and CI is the only signal the workflow provides
const onCi = process.env.CI !== undefined;

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		include: ["src/**/*.test.{ts,tsx}"],
		exclude: onCi
			? [...configDefaults.exclude, "src/bot/skins.test.ts"]
			: configDefaults.exclude,
		coverage: {
			include: ["src/**/*.{ts,tsx}", "!src/**/*.test.{ts,tsx}"],
			reporter: ["json", "text-summary"],
			thresholds: {
				statements: 92,
				branches: 87,
				functions: 86,
				lines: 92,
			},
		},
	},
});
