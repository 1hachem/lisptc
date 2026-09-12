import { copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import devServer from "@hono/vite-dev-server";
import { serverEnv } from "@repo/env/server";
import { defineConfig, type Plugin } from "vite";

const INTERPRETER = new URL(
	".",
	import.meta.resolve("@repo/interpreter/package.json"),
);
const LLM = new URL(".", import.meta.resolve("@repo/llm/package.json"));

const RUNTIME_ASSETS: [root: URL, asset: string][] = [
	[INTERPRETER, "src/SKILL.ptc"],
	[INTERPRETER, "src/compaction.ptc"],
	[INTERPRETER, "src/mcp.ptc"],
	[INTERPRETER, "src/promises.ptc"],
	[INTERPRETER, "src/prose.ptc"],
	[INTERPRETER, "src/secrets.ptc"],
	[INTERPRETER, "src/lisptc.gbnf"],
	[INTERPRETER, "mcp.toolkit.json"],
	[LLM, "src/llm.ptc"],
];

function copyRuntimeAssets(): Plugin {
	return {
		name: "copy-interpreter-runtime-assets",
		apply: "build",
		closeBundle() {
			for (const [root, asset] of RUNTIME_ASSETS) {
				const name = asset.split("/").pop() as string;
				copyFileSync(fileURLToPath(new URL(asset, root)), `dist/${name}`);
			}
		},
	};
}

function flushTelemetry(): Plugin {
	let flushed = false;
	return {
		name: "flush-telemetry-on-close",
		apply: "serve",
		configureServer(server) {
			process.once("SIGINT", () => {
				void server.close().then(() => process.exit(0));
			});
		},
		async closeBundle() {
			if (flushed) return;
			flushed = true;
			await (
				globalThis as { __lisptcFlushTelemetry?: () => Promise<void> }
			).__lisptcFlushTelemetry?.();
		},
	};
}

export default defineConfig({
	server: {
		port: serverEnv.PORT,
		strictPort: true,
	},
	plugins: [
		devServer({ entry: "src/app.ts" }),
		flushTelemetry(),
		copyRuntimeAssets(),
	],
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
