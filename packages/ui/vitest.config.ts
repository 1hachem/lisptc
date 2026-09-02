import { defineConfig } from "vitest/config";

/*
 * Environment `node` by default, and a DOM asked for per file, in its first line
 * (`// @vitest-environment happy-dom`). No React plugin: vitest transforms TSX
 * with esbuild, which picks the automatic JSX runtime up from `tsconfig.json`.
 */
export default defineConfig({
	test: {
		environment: "node",
		include: ["src/**/*.test.{ts,tsx}"],
	},
});
