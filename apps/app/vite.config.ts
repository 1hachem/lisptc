import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

export default defineConfig({
	// Pinned, and matching what `pnpm start` serves the built output on: fail
	// loudly on a taken port rather than drift to the next one, since where the
	// app answers is something you tell a browser and an OAuth callback.
	server: { port: 3000, strictPort: true },
	plugins: [
		tailwindcss(),
		tanstackStart({ srcDirectory: "src" }),
		viteReact(),
		nitro(),
	],
	// @repo/ui ships .tsx source; let Vite transpile it instead of prebundling.
	optimizeDeps: {
		exclude: ["@repo/ui"],
	},
});
