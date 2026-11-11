import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";

const convexDir = fileURLToPath(new URL("../../convex/", import.meta.url));

const AUTH_SURFACE = new Set(["auth.ts", "http.ts", "posthog.ts"]);

const AUTH_LIBRARIES =
	/node_modules\/(better-auth|@better-auth\/[^/]+|@convex-dev\/better-auth|@posthog\/[^/]+)\//;

const BUNDLE_BUDGET_BYTES = 700_000;

const functionModules = readdirSync(convexDir)
	.filter((file) => file.endsWith(".ts") && !file.endsWith(".config.ts"))
	.filter((file) => !AUTH_SURFACE.has(file))
	.sort();

async function bundle(file: string) {
	const result = await build({
		entryPoints: [`${convexDir}${file}`],
		bundle: true,
		write: false,
		format: "esm",
		platform: "browser",
		conditions: ["convex", "module"],
		metafile: true,
		logLevel: "silent",
	});
	const [output] = result.outputFiles;
	return {
		bytes: output?.contents.length ?? 0,
		inputs: Object.keys(result.metafile.inputs),
	};
}

describe("a function module's bundle", () => {
	it.each(functionModules)("%s loads no auth library", async (file) => {
		const { inputs } = await bundle(file);
		const reached = [
			...new Set(
				inputs.flatMap((input) => input.match(AUTH_LIBRARIES)?.[1] ?? []),
			),
		];
		expect(reached).toEqual([]);
	});

	it.each(functionModules)("%s stays within the budget", async (file) => {
		const { bytes } = await bundle(file);
		expect(bytes).toBeLessThanOrEqual(BUNDLE_BUDGET_BYTES);
	});
});
