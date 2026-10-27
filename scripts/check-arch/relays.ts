import type { Check } from "./check.ts";

function importedNames(text: string): Set<string> {
	const names = new Set<string>();
	const re = /import\s+(?:type\s+)?([\s\S]*?)\s+from\s+"[^"]+"/g;
	for (let m = re.exec(text); m !== null; m = re.exec(text))
		for (const part of m[1].replace(/[{}]/g, ",").split(",")) {
			const name = part
				.trim()
				.replace(/^type\s+/, "")
				.split(/\s+as\s+/)
				.pop()
				?.replace(/^\*\s*/, "")
				.trim();
			if (name) names.add(name);
		}
	return names;
}

function relaysIn(text: string, entry: boolean): string[] {
	const found: string[] = [];
	for (const m of text.matchAll(
		/^export\s+(?:type\s+)?(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s*from\s+"([^"]+)"/gm,
	))
		if (!entry || !m[1].startsWith(".")) found.push(`re-exports from ${m[1]}`);
	const imported = importedNames(text);
	for (const m of text.matchAll(/^export\s+(?:type\s+)?\{([^}]*)\}\s*;/gm))
		for (const part of m[1].split(",")) {
			const name = part
				.trim()
				.replace(/^type\s+/, "")
				.split(/\s+as\s+/)[0];
			if (imported.has(name)) found.push(`re-exports ${name}`);
		}
	for (const m of text.matchAll(
		/^export\s+(?:type|const)\s+(\w+)\s*=\s*(\w+)\s*;/gm,
	))
		if (imported.has(m[2])) found.push(`renames ${m[2]} to ${m[1]}`);
	return found;
}

export const relays: Check = {
	name: "relayed names",
	rule: [
		"A name is exported once, by the module that declares it, and every",
		"importer names that module. Only a package's root entrypoint gathers",
		"names, and only from its own files.",
	],
	fix: [
		"Import it from where it is declared, and add a package.json export for",
		"that module if it has none.",
	],
	run: (tree) => {
		const entrypoints = new Set(
			[...tree.exported]
				.filter(
					([name]) => name.split("/").length === (name.startsWith("@") ? 2 : 1),
				)
				.map(([, file]) => file),
		);
		return tree.sources.flatMap((file) =>
			relaysIn(tree.read(file), entrypoints.has(file)).map((what) => ({
				file,
				what,
			})),
		);
	},
};
