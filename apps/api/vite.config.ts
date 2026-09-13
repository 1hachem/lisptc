import { copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import devServer from "@hono/vite-dev-server";
import { serverEnv } from "@repo/env/server";
import { defineConfig, type Plugin } from "vite";

const INTERPRETER_SRC = new URL(
	".",
	import.meta.resolve("@repo/interpreter/source"),
);

const PROMPT_FILES = [
	"SKILL.ptc",
	"compaction.ptc",
	"promises.ptc",
	"prose.ptc",
	"secrets.ptc",
];

const RUNTIME_ASSETS = [
	...PROMPT_FILES.map((name) => new URL(name, INTERPRETER_SRC)),
	new URL("mcp.ptc", new URL(import.meta.resolve("@repo/mcp"))),
	new URL("llm.ptc", new URL(import.meta.resolve("@repo/llm/llm"))),
	new URL(import.meta.resolve("@repo/mcp/mcp.toolkit.json")),
];

function copyRuntimeAssets(): Plugin {
	return {
		name: "copy-runtime-assets",
		apply: "build",
		closeBundle() {
			for (const asset of RUNTIME_ASSETS) {
				const name = asset.pathname.split("/").pop() as string;
				copyFileSync(fileURLToPath(asset), `dist/${name}`);
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
