import { copyFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";
import { assetName, RUNTIME_ASSETS } from "./runtime-assets.ts";

function chunkDirs(root: string): string[] {
	const dirs = readdirSync(root, { recursive: true, encoding: "utf8" })
		.filter((name) => name.endsWith(".mjs"))
		.map((name) => dirname(join(root, name)));
	return [...new Set(dirs)];
}

function copyRuntimeAssets(serverDir: string): void {
	for (const dir of chunkDirs(serverDir))
		for (const asset of RUNTIME_ASSETS)
			copyFileSync(fileURLToPath(asset), join(dir, assetName(asset)));
}

export default defineConfig({
	server: { port: 3000, strictPort: true },
	plugins: [
		tailwindcss(),
		tanstackStart({ srcDirectory: "src" }),
		viteReact(),
		nitro({
			serverDir: "server",
			hooks: {
				compiled: (built) => copyRuntimeAssets(built.options.output.serverDir),
			},
		}),
	],
	optimizeDeps: {
		exclude: ["@repo/components", "@repo/ui"],
	},
});
