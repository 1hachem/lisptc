import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		projects: [
			{
				test: {
					name: "convex",
					environment: "edge-runtime",
					testTimeout: 30_000,
					hookTimeout: 30_000,
					include: ["test/*.test.ts"],
					server: { deps: { inline: ["convex-test"] } },
				},
			},
			{
				test: {
					name: "extensions",
					environment: "node",
					include: ["test/extensions/*.test.ts"],
					setupFiles: ["./test/extensions/setup-env.ts"],
				},
			},
		],
	},
});
