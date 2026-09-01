import { copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import devServer from "@hono/vite-dev-server";
import { defineConfig, type Plugin } from "vite";

// Files the interpreter reads at runtime rather than imports, so no bundler can
// see them. They are read as `new URL("./<name>", import.meta.url)`, which in a
// build means "next to the emitted code" — so they belong in dist/. Paths are
// relative to the interpreter package root.
const RUNTIME_ASSETS = [
	"src/SKILL.md",
	"src/lisptc.gbnf",
	"mcp.toolkit.json",
];

function copyRuntimeAssets(): Plugin {
	return {
		name: "copy-interpreter-runtime-assets",
		apply: "build",
		closeBundle() {
			// `package.json` is the one entry every package exports, so it is the
			// reliable way to find the package root without reaching into pnpm's
			// node_modules layout.
			const root = new URL(
				".",
				import.meta.resolve("@repo/interpreter/package.json"),
			);
			for (const asset of RUNTIME_ASSETS) {
				const name = asset.split("/").pop() as string;
				copyFileSync(fileURLToPath(new URL(asset, root)), `dist/${name}`);
			}
		},
	};
}

export default defineConfig({
	server: {
		port: Number(process.env.PORT ?? 3001),
		// Fail loudly instead of silently moving to the next port, which the app's
		// hard-coded API base URL would never find.
		strictPort: true,
	},
	plugins: [devServer({ entry: "src/app.ts" }), copyRuntimeAssets()],
	build: {
		target: "node22",
		ssr: true,
		outDir: "dist",
		rollupOptions: {
			// Two entries, because the MCP broker runs in a worker thread: a worker
			// is a second entry point by definition and can never be folded into the
			// bundle that spawns it. `mcp.ts` looks for it beside itself, which is
			// `dist/mcp-broker.js` here.
			input: {
				index: "src/index.ts",
				"mcp-broker": "@repo/interpreter/mcp-broker.ts",
			},
			output: { format: "esm", entryFileNames: "[name].js" },
		},
	},
});
