import { configDefaults, defineConfig } from "vitest/config";

// biome-ignore lint/style/noProcessEnv: runner config, and CI is the only signal the workflow provides
const onCi = process.env.CI !== undefined;

const STARVES_THE_CI_RUNNER = ["src/bot/skins.test.ts"];

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		include: ["src/**/*.test.{ts,tsx}"],
		exclude: onCi
			? [...configDefaults.exclude, ...STARVES_THE_CI_RUNNER]
			: configDefaults.exclude,
	},
});
