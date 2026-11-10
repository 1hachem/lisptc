import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { providerSpecs } from "@repo/env/providers";
import ts from "typescript";
import {
	isProviderName,
	PROVIDER_CATALOG,
	PROVIDER_NAMES,
	type ProviderName,
	providerSpecFor,
} from "../packages/shared/src/providers.ts";

const CATALOG_FILE = new URL(
	"../packages/shared/src/providers.ts",
	import.meta.url,
).pathname;

interface Offered {
	id: string;
	name?: string;
}

function usage(): never {
	console.error(
		`usage: task model:add -- <${PROVIDER_NAMES.join("|")}> <model-id> [display name] [--commit]`,
	);
	process.exit(2);
}

function fail(message: string): never {
	console.error(message);
	process.exit(1);
}

async function offeredBy(provider: ProviderName): Promise<Offered[]> {
	const spec = providerSpecFor(provider, providerSpecs);
	const response = await fetch(`${spec.baseUrl}/models`, {
		headers: spec.apiKey ? { Authorization: `Bearer ${spec.apiKey}` } : {},
	});
	if (!response.ok)
		fail(
			`${spec.label} answered ${response.status} on /models, is ${spec.apiKeyEnv} set?`,
		);
	const body = (await response.json()) as { data: Offered[] };
	return body.data;
}

function closest(id: string, offered: Offered[]): string[] {
	const words = id
		.toLowerCase()
		.split(/[/:._-]+/)
		.filter(Boolean);
	return offered
		.map((o) => ({
			id: o.id,
			score: words.filter((w) => o.id.toLowerCase().includes(w)).length,
		}))
		.filter((o) => o.score > 0)
		.sort((a, b) => b.score - a.score)
		.slice(0, 5)
		.map((o) => o.id);
}

function displayName(offered: Offered | undefined, id: string): string {
	const vendorName = offered?.name?.replace(/^[^:]+:\s*/, "");
	return vendorName || id.slice(id.lastIndexOf("/") + 1);
}

function modelsArray(
	source: ts.SourceFile,
	provider: ProviderName,
): ts.ArrayLiteralExpression {
	let found: ts.ArrayLiteralExpression | undefined;
	const visit = (node: ts.Node): void => {
		if (
			ts.isPropertyAssignment(node) &&
			node.name.getText(source) === "models" &&
			ts.isArrayLiteralExpression(node.initializer) &&
			ts.isObjectLiteralExpression(node.parent) &&
			ts.isPropertyAssignment(node.parent.parent) &&
			node.parent.parent.name.getText(source) === provider
		)
			found = node.initializer;
		ts.forEachChild(node, visit);
	};
	visit(source);
	if (!found) fail(`no models array for ${provider} in ${CATALOG_FILE}`);
	return found;
}

function insert(provider: ProviderName, id: string, name: string): void {
	const text = readFileSync(CATALOG_FILE, "utf8");
	const source = ts.createSourceFile(
		CATALOG_FILE,
		text,
		ts.ScriptTarget.Latest,
		true,
	);
	const array = modelsArray(source, provider);
	const entry = `{ id: ${JSON.stringify(id)}, name: ${JSON.stringify(name)} }`;
	const last = array.elements.at(-1);
	const at = last ? last.getEnd() : array.getStart(source) + 1;
	const glue = last ? ", " : "";
	writeFileSync(
		CATALOG_FILE,
		`${text.slice(0, at)}${glue}${entry}${text.slice(at)}`,
	);
	execFileSync("pnpm", ["exec", "biome", "format", "--write", CATALOG_FILE], {
		stdio: "inherit",
	});
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	const commit = args.includes("--commit");
	const [provider, id, ...rest] = args.filter((a) => a !== "--commit");
	if (!provider || !id) usage();
	if (!isProviderName(provider)) usage();

	const catalog = PROVIDER_CATALOG[provider].models as readonly Offered[];
	if (catalog.some((m) => m.id === id))
		fail(`${provider}:${id} is already in the catalog`);

	const offered = await offeredBy(provider);
	const match = offered.find((o) => o.id === id);
	if (!match) {
		const near = closest(id, offered);
		fail(
			`${PROVIDER_CATALOG[provider].label} does not serve ${id}${near.length ? `, did you mean:\n  ${near.join("\n  ")}` : ""}`,
		);
	}

	const name = rest.join(" ") || displayName(match, id);
	insert(provider, id, name);
	console.log(`added ${provider}:${id} as "${name}"`);

	if (commit) {
		execFileSync("git", ["add", CATALOG_FILE], { stdio: "inherit" });
		execFileSync(
			"git",
			[
				"commit",
				"-m",
				`feat(shared): add ${name.toLowerCase()} to the ${PROVIDER_CATALOG[provider].label.toLowerCase()} catalog`,
			],
			{ stdio: "inherit" },
		);
	}
}

await main();
