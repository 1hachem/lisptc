import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Check, Field, Manifest } from "./check.ts";

function manifestsTagged(tag: string): string[] {
	return execFileSync(
		"git",
		["ls-files", "packages/*/turbo.json", "apps/*/turbo.json"],
		{ encoding: "utf8" },
	)
		.split("\n")
		.filter((file) => file !== "")
		.filter((file) =>
			(
				JSON.parse(readFileSync(file, "utf8")) as { tags?: string[] }
			).tags?.includes(tag),
		)
		.map((file) => join(dirname(file), "package.json"));
}

export const staticPackages: Check = {
	name: "static packages",
	rule: [
		"A package tagged static is data. It depends on a foundation package",
		"at most, and builds on no workspace package outside the foundation.",
	],
	fix: ["Drop the dependency, or move the code that needs it out of the data."],
	run: () => {
		const foundation = new Set(
			manifestsTagged("foundation").map(
				(manifest) =>
					(JSON.parse(readFileSync(manifest, "utf8")) as { name: string }).name,
			),
		);
		return manifestsTagged("static").flatMap((file) => {
			const manifest = JSON.parse(readFileSync(file, "utf8")) as Manifest;
			const forbidden: [Field, (name: string) => boolean][] = [
				["dependencies", (name) => !foundation.has(name)],
				["peerDependencies", (name) => !foundation.has(name)],
				[
					"devDependencies",
					(name) => name.startsWith("@repo/") && !foundation.has(name),
				],
			];
			return forbidden.flatMap(([field, isForbidden]) =>
				Object.keys(manifest[field] ?? {})
					.filter(isForbidden)
					.map((name) => ({ file, what: `lists ${name} in ${field}` })),
			);
		});
	},
};
