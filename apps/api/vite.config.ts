import { copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import devServer from "@hono/vite-dev-server";
import { defineConfig, type Plugin } from "vite";

const RUNTIME_ASSETS = ["src/SKILL.md", "src/lisptc.gbnf", "mcp.toolkit.json"];

function copyRuntimeAssets(): Plugin {
	return {
		name: "copy-interpreter-runtime-assets",
		apply: "build",
		closeBundle() {
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
		strictPort: true,
	},
	plugins: [devServer({ entry: "src/app.ts" }), copyRuntimeAssets()],
	build: {
		target: "node22",
		ssr: true,
		outDir: "dist",
		rollupOptions: {
			input: { index: "src/index.ts" },
			output: { format: "esm", entryFileNames: "[name].js" },
		},
	},
});
