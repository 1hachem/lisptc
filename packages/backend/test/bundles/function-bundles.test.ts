import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

interface Bundled {
	readonly bytes: number;
	readonly inputs: readonly string[];
}

interface ConvexBundler {
	build(options: Record<string, unknown>): Promise<{
		outputFiles: { contents: Uint8Array }[];
		metafile: { inputs: Record<string, unknown> };
	}>;
}

const convexDir = fileURLToPath(new URL("../../convex/", import.meta.url));

const fromConvex = createRequire(
	createRequire(import.meta.url).resolve("convex/package.json"),
);
const bundler = fromConvex("esbuild") as ConvexBundler;

const AUTH_SURFACE = new Set(["auth.ts", "http.ts", "posthog.ts"]);

const AUTH_LIBRARIES =
	/node_modules\/(better-auth|@better-auth\/[^/]+|@convex-dev\/better-auth|@posthog\/[^/]+)\//;

const BUNDLE_BUDGET_BYTES = 700_000;

const functionModules = readdirSync(convexDir, { recursive: true })
	.map(String)
	.filter((path) => path.endsWith(".ts") && !path.endsWith(".config.ts"))
	.filter((path) => !path.startsWith("_generated"))
	.filter((path) => !AUTH_SURFACE.has(path))
	.sort();

const bundles = new Map<string, Promise<Bundled>>();

function bundle(path: string): Promise<Bundled> {
	const cached = bundles.get(path);
	if (cached !== undefined) return cached;
	const built = bundler
		.build({
			entryPoints: [`${convexDir}${path}`],
			bundle: true,
			write: false,
			format: "esm",
			platform: "browser",
			conditions: ["convex", "module"],
			metafile: true,
			logLevel: "silent",
		})
		.then((result) => ({
			bytes: result.outputFiles[0]?.contents.length ?? 0,
			inputs: Object.keys(result.metafile.inputs),
		}));
	bundles.set(path, built);
	return built;
}

describe("a function module's bundle", () => {
	it.each(functionModules)("%s loads no auth library", async (path) => {
		const { inputs } = await bundle(path);
		const reached = [
			...new Set(
				inputs.flatMap((input) => input.match(AUTH_LIBRARIES)?.[1] ?? []),
			),
		];
		expect(reached).toEqual([]);
	});

	it.each(functionModules)("%s stays within the budget", async (path) => {
		const { bytes } = await bundle(path);
		expect(bytes).toBeLessThanOrEqual(BUNDLE_BUDGET_BYTES);
	});
});
