import { execFileSync } from "node:child_process";

const ALLOWED = [
	/^(.+\/)?README\.md$/,
	/^(.+\/)?AGENTS\.md$/,
	/^(.+\/)?CLAUDE\.md$/,
	/^\.github\//,
	/^\.claude\/skills\//,
	/^\.claude\/agents\//,
];

function tracked(): string[] {
	const out = execFileSync("git", ["ls-files", "*.md", "*.mdx", "*.markdown"], {
		encoding: "utf8",
	});
	return out.split("\n").filter(Boolean);
}

const fix = process.argv.includes("--fix");
const files = tracked();
const offenders = files.filter((f) => !ALLOWED.some((re) => re.test(f)));

if (offenders.length === 0) {
	console.log(
		`No stray docs in ${files.length} markdown file${files.length === 1 ? "" : "s"}.`,
	);
	process.exit(0);
}

if (fix) {
	execFileSync("git", ["rm", "-q", "-f", "--", ...offenders]);
	for (const file of offenders) console.log(`Removed ${file}`);
	console.log(
		`Removed ${offenders.length} markdown file${offenders.length === 1 ? "" : "s"}. Review the diff.`,
	);
	process.exit(0);
}

for (const file of offenders) console.error(file);
console.error("");
console.error(
	`${offenders.length} markdown file${offenders.length === 1 ? "" : "s"} outside the allowlist.`,
);
console.error("");
console.error(
	"This repo keeps no design notes: the code is the only source of",
);
console.error("truth. A constraint worth keeping goes in a name, a type or a");
console.error(
	"test. Only README, a package README.md, an AGENTS.md, .github/ and",
);
console.error(
	"the skills and agents under .claude/ may be markdown. Run",
);
console.error("`pnpm fix:docs` to delete them, or widen");
console.error(
	"ALLOWED in scripts/check-docs.ts if the repo really gained one.",
);
process.exit(1);
