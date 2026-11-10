import { fileURLToPath } from "node:url";
import {
	bundledEntries,
	devEntries,
	machineEntries,
	TOOLKIT_ROOT,
	type ToolkitEntry,
} from "@repo/toolkit";
import type {
	ConnConfig,
	EnvLookup,
	LocalConnConfig,
	ToolkitRegistry,
} from "./ports.ts";

export const processEnv: EnvLookup = {
	// biome-ignore lint/style/noProcessEnv: a toolkit entry names the variable, so it is only known at runtime
	get: (name) => process.env[name],
};

function expandEnv(s: string, env: EnvLookup): string {
	return s.replace(/\$\{(\w+)\}/g, (_, name) => env.get(name) ?? "");
}

function resolveAgainst(s: string, root: URL): string {
	return s.startsWith("./") || s.startsWith("../")
		? fileURLToPath(new URL(s, root))
		: s;
}

export function entriesToolkit(
	entries: readonly ToolkitEntry[],
	env: EnvLookup = processEnv,
	root: URL = TOOLKIT_ROOT,
): ToolkitRegistry {
	const configs: ConnConfig[] = entries.map((conf) =>
		conf.args === undefined
			? conf
			: {
					...conf,
					args: conf.args.map((a) => resolveAgainst(expandEnv(a, env), root)),
				},
	);
	return { all: () => configs };
}

export function bundledToolkit(env: EnvLookup = processEnv): ToolkitRegistry {
	return entriesToolkit(bundledEntries, env);
}

export function localToolkit(env: EnvLookup = processEnv): ToolkitRegistry {
	return entriesToolkit(devEntries, env);
}

export function machineToolkit(env: EnvLookup = processEnv): ToolkitRegistry {
	return entriesToolkit(machineEntries, env);
}

export interface Bridged {
	readonly own: LocalConnConfig[];
	readonly variants: LocalConnConfig[];
}

export function bridgedEntries(
	bundled: ToolkitRegistry,
	local: ToolkitRegistry,
): Bridged {
	const taken = new Set(bundled.all().map((conf) => conf.name));
	const commands = local
		.all()
		.flatMap((conf): LocalConnConfig[] =>
			"url" in conf ? [] : [{ ...conf, local: true }],
		);
	return {
		own: commands.filter((conf) => !taken.has(conf.name)),
		variants: commands.filter((conf) => taken.has(conf.name)),
	};
}

export function desktopToolkit(
	bundled: ToolkitRegistry,
	bridged: Bridged,
	connected: () => boolean,
): ToolkitRegistry {
	return {
		all: () =>
			connected() ? [...bundled.all(), ...bridged.own] : bundled.all(),
		local: (name) =>
			connected()
				? bridged.variants.find((conf) => conf.name === name)
				: undefined,
	};
}
