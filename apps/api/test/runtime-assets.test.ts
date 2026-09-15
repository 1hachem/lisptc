import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { assetName, PROMPT_ROOTS, RUNTIME_ASSETS } from "../runtime-assets.ts";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));

const REFERENCE =
	/new URL\(\s*"\.\/([\w.-]+\.ptc)"\s*,\s*import\.meta\.url\s*\)/g;

interface Reference {
	from: string;
	file: string;
}

function references(): Reference[] {
	const sources = execFileSync("git", ["ls-files", "*.ts"], {
		cwd: ROOT,
		encoding: "utf8",
	})
		.split("\n")
		.filter((file) => file !== "");
	return sources.flatMap((file) => {
		const path = resolve(ROOT, file);
		if (!existsSync(path)) return [];
		const text = readFileSync(path, "utf8");
		return [...text.matchAll(REFERENCE)].map((m) => ({
			from: file,
			file: resolve(dirname(path), m[1]),
		}));
	});
}

const referenced = references();
const shipped = RUNTIME_ASSETS.map((asset) => fileURLToPath(asset));

describe("the prompts a build has to ship", () => {
	it("names files that exist", () => {
		const missing = referenced.filter(({ file }) => !existsSync(file));
		expect(missing).toEqual([]);
	});

	it("finds at least one prompt under every root it scans", () => {
		expect(referenced.length).toBeGreaterThan(0);
		for (const root of PROMPT_ROOTS) {
			const dir = fileURLToPath(root);
			expect(shipped.some((file) => file.startsWith(dir))).toBe(true);
		}
	});

	it("ships every prompt a module asks for at runtime", () => {
		const unshipped = referenced.filter(({ file }) => !shipped.includes(file));
		expect(unshipped).toEqual([]);
	});

	it("gives each one a distinct name, because the build flattens them", () => {
		const names = RUNTIME_ASSETS.map(assetName);
		expect(names).toEqual([...new Set(names)]);
	});
});
