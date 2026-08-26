import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

export default defineConfig({
	server: { port: 5173 },
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
