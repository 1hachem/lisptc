import {
	existsSync,
	globSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import libCoverage from "istanbul-lib-coverage";
import libReport from "istanbul-lib-report";
import reports from "istanbul-reports";

const OUT = "coverage";

const BADGE_COLORS: ReadonlyArray<readonly [number, string]> = [
	[90, "brightgreen"],
	[80, "green"],
	[70, "yellowgreen"],
	[60, "yellow"],
	[50, "orange"],
	[0, "red"],
];

const inputs = globSync("{apps,packages}/*/coverage/coverage-final.json");
if (inputs.length === 0) {
	console.error("no coverage-final.json found: run `pnpm test:coverage` first");
	process.exit(1);
}

const coverageMap = libCoverage.createCoverageMap({});
for (const file of inputs) {
	coverageMap.merge(JSON.parse(readFileSync(file, "utf8")));
}

mkdirSync(OUT, { recursive: true });
const context = libReport.createContext({ dir: OUT, coverageMap });
for (const name of ["json", "json-summary", "html", "text-summary"] as const) {
	reports.create(name).execute(context);
}

const writeBadge = (
	path: string,
	label: string,
	map: libCoverage.CoverageMap,
) => {
	const pct = map.getCoverageSummary().lines.pct;
	const color = BADGE_COLORS.find(([floor]) => pct >= floor)?.[1] ?? "red";
	writeFileSync(
		path,
		`${JSON.stringify({ schemaVersion: 1, label, message: `${pct}%`, color })}\n`,
	);
};

writeBadge(`${OUT}/badge.json`, "coverage", coverageMap);

const INTERPRETER = "packages/interpreter/coverage/coverage-final.json";
if (existsSync(INTERPRETER)) {
	writeBadge(
		`${OUT}/badge-interpreter.json`,
		"interpreter coverage",
		libCoverage.createCoverageMap(
			JSON.parse(readFileSync(INTERPRETER, "utf8")),
		),
	);
} else {
	console.error(`${INTERPRETER} is missing: skipping the interpreter badge`);
}
console.log(`merged ${inputs.length} reports into ${OUT}/`);
