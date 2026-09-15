import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ConnConfig, EnvLookup, ToolkitRegistry } from "./ports.ts";

const FROM_SOURCE = import.meta.url.endsWith(".ts");

const TOOLKIT_URL = new URL(
	FROM_SOURCE ? "../mcp.toolkit.json" : "./mcp.toolkit.json",
	import.meta.url,
);

export const processEnv: EnvLookup = {
	// biome-ignore lint/style/noProcessEnv: mcp.toolkit.json names the variable, so it is only known at runtime
	get: (name) => process.env[name],
};

function expandEnv(s: string, env: EnvLookup): string {
	return s.replace(/\$\{(\w+)\}/g, (_, name) => env.get(name) ?? "");
}

function resolveBundled(s: string): string {
	return s.startsWith("./") || s.startsWith("../")
		? fileURLToPath(new URL(s, TOOLKIT_URL))
		: s;
}

export function jsonToolkit(
	raw: string,
	env: EnvLookup = processEnv,
): ToolkitRegistry {
	let configs: ConnConfig[];
	try {
		const parsed = JSON.parse(raw) as ConnConfig[];
		configs = parsed.filter((conf) => Boolean(conf?.name));
		for (const conf of configs)
			if ("args" in conf && conf.args)
				conf.args = conf.args.map((a) => resolveBundled(expandEnv(a, env)));
	} catch {
		configs = [];
	}
	return { all: () => configs };
}

export function bundledToolkit(env: EnvLookup = processEnv): ToolkitRegistry {
	try {
		return jsonToolkit(readFileSync(TOOLKIT_URL, "utf8"), env);
	} catch {
		return { all: () => [] };
	}
}
