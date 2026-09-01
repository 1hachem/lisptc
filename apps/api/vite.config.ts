import devServer from "@hono/vite-dev-server";
import { defineConfig } from "vite";

export default defineConfig({
	server: {
		port: Number(process.env.PORT ?? 3001),
		// Fail loudly instead of silently moving to the next port, which the app's
		// hard-coded API base URL would never find.
		strictPort: true,
	},
	plugins: [devServer({ entry: "src/app.ts" })],
	build: {
		target: "node22",
		ssr: "src/index.ts",
		outDir: "dist",
		rollupOptions: {
			// The workspace packages ship .ts and have no build of their own — node
			// runs their sources directly, which is why `start` keeps
			// `--experimental-transform-types`. Bundling them would also rewrite the
			// interpreter's `new Worker(new URL("./mcp-broker.ts", import.meta.url))`
			// to a path inside dist/, where that worker file does not exist, and MCP
			// would fail in production only.
			external: [/^@repo\//],
			output: { format: "esm" },
		},
	},
});
