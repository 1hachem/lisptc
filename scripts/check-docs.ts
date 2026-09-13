import { execFileSync } from "node:child_process";

const ALLOWED = [/^(.+\/)?README\.md$/, /^(.+\/)?CLAUDE\.md$/, /^\.github\//];

function tracked(): string[] {
	const out = execFileSync("git", ["ls-files", "*.md", "*.mdx", "*.markdown"], {
		encoding: "utf8",
	});
	return out.split("\n").filter(Boolean);
}

const files = tracked();
const offenders = files.filter((f) => !ALLOWED.some((re) => re.test(f)));

if (offenders.length === 0) {
	console.log(
		`No stray docs in ${files.length} markdown file${files.length === 1 ? "" : "s"}.`,
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
	"test. Only README, a package README.md, a CLAUDE.md and .github/",
);
console.error("may be markdown. Delete these, or widen ALLOWED in");
console.error("scripts/check-docs.ts if the repo really gained a new one.");
process.exit(1);
