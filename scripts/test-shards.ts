import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

type Timings = Record<string, number>;

interface TurboTask {
	package: string;
	command?: string;
	cache?: { status: "HIT" | "MISS"; timeSaved: number };
	execution?: { startTime: number; endTime: number; exitCode: number };
}

const MAX_SHARDS = 4;
const SECONDS_PER_SHARD = 60;
const UNKNOWN_PACKAGE_SECONDS = 20;

const readJson = <T>(path: string, fallback: T): T => {
	try {
		return JSON.parse(readFileSync(path, "utf8")) as T;
	} catch {
		return fallback;
	}
};

const testedPackages = (dryRun: { tasks: TurboTask[] }): string[] =>
	[
		...new Set(
			dryRun.tasks
				.filter((task) => task.command && task.command !== "<NONEXISTENT>")
				.map((task) => task.package),
		),
	].sort();

const packIntoShards = (packages: string[], timings: Timings): string[][] => {
	const weight = (name: string) => timings[name] ?? UNKNOWN_PACKAGE_SECONDS;
	const total = packages.reduce((sum, name) => sum + weight(name), 0);
	const count = Math.max(
		1,
		Math.min(MAX_SHARDS, packages.length, Math.ceil(total / SECONDS_PER_SHARD)),
	);
	const shards = Array.from({ length: count }, () => ({
		load: 0,
		packages: [] as string[],
	}));
	for (const name of [...packages].sort((a, b) => weight(b) - weight(a))) {
		const lightest = shards.reduce((min, shard) =>
			shard.load < min.load ? shard : min,
		);
		lightest.load += weight(name);
		lightest.packages.push(name);
	}
	return shards.map((shard) => shard.packages);
};

const plan = (dryRunPath: string, timingsPath: string) => {
	const packages = testedPackages(readJson(dryRunPath, { tasks: [] }));
	const shards =
		packages.length === 0
			? []
			: packIntoShards(packages, readJson<Timings>(timingsPath, {}));
	console.log(
		JSON.stringify(
			shards.map((names, index) => ({
				name: `${index + 1}/${shards.length}`,
				filters: names.map((name) => `--filter=${name}`).join(" "),
			})),
		),
	);
};

const taskMilliseconds = (task: TurboTask): number | undefined => {
	if (task.cache?.status === "HIT" && task.cache.timeSaved > 0) {
		return task.cache.timeSaved;
	}
	if (task.cache?.status === "MISS" && task.execution?.exitCode === 0) {
		return task.execution.endTime - task.execution.startTime;
	}
	return undefined;
};

const measuredSeconds = (runsDir: string): Timings => {
	const measured: Timings = {};
	const summaries = readdirSync(runsDir, { recursive: true })
		.map(String)
		.filter((file) => file.endsWith(".json"));
	for (const file of summaries) {
		const summary = readJson<{ tasks: TurboTask[] }>(join(runsDir, file), {
			tasks: [],
		});
		for (const task of summary.tasks) {
			const milliseconds = taskMilliseconds(task);
			if (milliseconds !== undefined) {
				measured[task.package] = Math.round(milliseconds / 100) / 10;
			}
		}
	}
	return measured;
};

const record = (previousPath: string, runsDir: string) => {
	const merged = {
		...readJson<Timings>(previousPath, {}),
		...measuredSeconds(runsDir),
	};
	const sorted = Object.fromEntries(
		Object.entries(merged).sort(([a], [b]) => a.localeCompare(b)),
	);
	console.log(JSON.stringify(sorted, null, 2));
};

const [command, first, second] = process.argv.slice(2);
if (command === "plan" && first && second) {
	plan(first, second);
} else if (command === "record" && first && second) {
	record(first, second);
} else {
	console.error(
		"usage: test-shards plan <turbo-dry-run.json> <timings.json>\n       test-shards record <timings.json> <turbo-runs-dir>",
	);
	process.exit(1);
}
