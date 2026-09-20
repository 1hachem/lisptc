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
	},
});
