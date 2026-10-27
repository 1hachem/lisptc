import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";
import { carriers } from "./check-arch/carriers.ts";
import {
	type Check,
	exportedFiles,
	type Tree,
	type Violation,
} from "./check-arch/check.ts";
import { extensionBlind } from "./check-arch/extension-blind.ts";
import { extensionHost } from "./check-arch/extension-host.ts";
import { extensionReach } from "./check-arch/extension-reach.ts";
import { manifests } from "./check-arch/manifests.ts";
import { mcpCluster } from "./check-arch/mcp-cluster.ts";
import { relays } from "./check-arch/relays.ts";
import { restrictedImports } from "./check-arch/restricted-imports.ts";
import { sessionDrivers } from "./check-arch/session-drivers.ts";
import { sniffers } from "./check-arch/sniffers.ts";
import { staticPackages } from "./check-arch/static-packages.ts";

interface TurnStarterRule {
	dir: string;
	allowed: string[];
}

const TURN_STARTERS: TurnStarterRule[] = [
	{ dir: "packages/ai/src/", allowed: ["packages/ai/src/thread.ts"] },
	{ dir: "apps/app/server/", allowed: [] },
];

const STARTS_A_TURN = /(?<!function\*?\s*)\brunAgentTurn\s*\(/;

const turnStarters: Check = {
	name: "turn started from a request",
	rule: [
		"A file calls runAgentTurn. A turn starts from a post, never from a",
		"request.",
	],
	fix: [
		"Post an envelope to the thread, and the thread runs the turn.",
		"TURN_STARTERS in scripts/check-arch.ts names the one file that may start one.",
	],
	run: (tree) =>
		TURN_STARTERS.flatMap(({ dir, allowed }) =>
			tree.sources
				.filter((file) => file.startsWith(dir) && !allowed.includes(file))
				.filter((file) => STARTS_A_TURN.test(tree.read(file)))
				.map((file): Violation => ({ file, what: "calls runAgentTurn" })),
		),
};

const CHECKS: Check[] = [
	manifests,
	staticPackages,
	restrictedImports,
	mcpCluster,
	extensionReach,
	extensionHost,
	sessionDrivers,
	extensionBlind,
	carriers,
	sniffers,
	relays,
	turnStarters,
];

const self = relative(process.cwd(), fileURLToPath(import.meta.url));

const sources = execFileSync("git", ["ls-files", "*.ts", "*.tsx"], {
	encoding: "utf8",
})
	.split("\n")
	.filter(
		(file) =>
			file !== "" &&
			file !== self &&
			!file.startsWith("scripts/check-arch/") &&
			existsSync(file),
	);

const texts = new Map<string, string>();

const tree: Tree = {
	sources,
	exported: exportedFiles(),
	read: (file) => {
		const known = texts.get(file);
		if (known !== undefined) return known;
		const text = readFileSync(file, "utf8");
		texts.set(file, text);
		return text;
	},
};

function many(count: number, noun: string): string {
	return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

const failed = CHECKS.map((check) => ({
	check,
	violations: check.run(tree),
})).filter(({ violations }) => violations.length > 0);

if (failed.length === 0) {
	console.log(
		`No architecture violations: ${many(CHECKS.length, "check")} passed over ${many(sources.length, "source")}.`,
	);
	process.exit(0);
}

for (const { check, violations } of failed) {
	console.error(`✗ ${check.name}: ${many(violations.length, "violation")}`);
	for (const line of check.rule) console.error(`  ${line}`);
	console.error("");
	for (const { file, what, why } of violations) {
		console.error(`  ${file} ${what}`);
		if (why) console.error(`    ${why}`);
	}
	console.error("");
	console.error("  Way out:");
	for (const line of check.fix) console.error(`    ${line}`);
	console.error("");
}

const total = failed.reduce(
	(sum, { violations }) => sum + violations.length,
	0,
);
console.error(
	`${many(total, "violation")} in ${many(failed.length, "check")} of ${CHECKS.length}: ${failed.map(({ check }) => check.name).join(", ")}.`,
);
process.exit(1);
