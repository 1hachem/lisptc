import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { TOOLKIT_URL } from "@repo/toolkit";
import type { ConnConfig, EnvLookup, ToolkitRegistry } from "./ports.ts";

const LOCAL_TOOLKIT_URL = new URL(
	import.meta.url.endsWith(".ts")
		? "../mcp.toolkit.local.json"
		: "./mcp.toolkit.local.json",
	import.meta.url,
);

export const processEnv: EnvLookup = {
	// biome-ignore lint/style/noProcessEnv: mcp.toolkit.json names the variable, so it is only known at runtime
	get: (name) => process.env[name],
};

function expandEnv(s: string, env: EnvLookup): string {
	return s.replace(/\$\{(\w+)\}/g, (_, name) => env.get(name) ?? "");
}

function resolveAgainst(s: string, manifest: URL): string {
	return s.startsWith("./") || s.startsWith("../")
		? fileURLToPath(new URL(s, manifest))
		: s;
}

export function jsonToolkit(
	raw: string,
	env: EnvLookup = processEnv,
	manifest: URL = TOOLKIT_URL,
): ToolkitRegistry {
	let configs: ConnConfig[];
	try {
		const parsed = JSON.parse(raw) as ConnConfig[];
		configs = parsed.filter((conf) => Boolean(conf?.name));
		for (const conf of configs)
			if ("args" in conf && conf.args)
				conf.args = conf.args.map((a) =>
					resolveAgainst(expandEnv(a, env), manifest),
				);
	} catch {
		configs = [];
	}
	return { all: () => configs };
}

function fileToolkit(url: URL, env: EnvLookup): ToolkitRegistry {
	try {
		return jsonToolkit(readFileSync(url, "utf8"), env);
	} catch {
		return { all: () => [] };
	}
}

export function bundledToolkit(env: EnvLookup = processEnv): ToolkitRegistry {
	return fileToolkit(TOOLKIT_URL, env);
}

export function localToolkit(env: EnvLookup = processEnv): ToolkitRegistry {
	return fileToolkit(LOCAL_TOOLKIT_URL, env);
}

export function bridgedEntries(
	bundled: ToolkitRegistry,
	local: ToolkitRegistry,
): ConnConfig[] {
	const taken = new Set(bundled.all().map((conf) => conf.name));
	return local
		.all()
		.filter((conf) => !taken.has(conf.name))
		.flatMap((conf) =>
			"url" in conf || "image" in conf ? [] : [{ ...conf, local: true }],
		);
}

export function desktopToolkit(
	bundled: ToolkitRegistry,
	bridged: readonly ConnConfig[],
	connected: () => boolean,
): ToolkitRegistry {
	return {
		all: () => (connected() ? [...bundled.all(), ...bridged] : bundled.all()),
	};
}
