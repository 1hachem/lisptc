import { git } from "./repo.ts";

const RECORD = "\u0000";
const FIELD = "\u001f";
const SWEEP_LIMIT = 25;
const MIN_COCHANGE_COMMITS = 3;
const RECENT_SHARE = 0.25;
const ACCELERATING = 1.3;
const COOLING = 0.7;

export type Trend = "accelerating" | "stable" | "cooling";

interface Touch {
	path: string;
	added: number;
	deleted: number;
}

interface Commit {
	sha: string;
	date: string;
	author: string;
	touches: Touch[];
}

interface FileStats {
	commits: number;
	added: number;
	deleted: number;
	first: string;
	last: string;
	recent: number;
}

export interface FileHistory {
	path: string;
	pkg: string;
	isTest: boolean;
	commits: number;
	added: number;
	deleted: number;
	first: string;
	last: string;
	trend: Trend;
}

export interface Series {
	key: string;
	counts: number[];
	churn: number[];
}

export interface Timeline {
	weeks: string[];
	packages: Series[];
	files: Series[];
}

export interface Pair {
	a: string;
	b: string;
	together: number;
	aCommits: number;
	bCommits: number;
	strength: number;
}

export interface History {
	head: string;
	commits: number;
	authors: number;
	files: FileHistory[];
	timeline: Timeline;
	cochange: { files: Pair[]; packages: Pair[] };
}

function packageOf(path: string): string {
	return /^((?:packages|apps)\/[^/]+)\//.exec(path)?.[1] ?? "root";
}

function isTestPath(path: string): boolean {
	return (
		/(^|\/)(test|tests|evals)\//.test(path) || /\.(test|spec|eval)\./.test(path)
	);
}

export function weekOf(date: string): string {
	const at = new Date(`${date}T00:00:00Z`);
	const day = (at.getUTCDay() + 6) % 7;
	at.setUTCDate(at.getUTCDate() - day);
	return at.toISOString().slice(0, 10);
}

export async function readHistory(): Promise<History> {
	const raw = await git([
		"log",
		"--no-merges",
		"--numstat",
		"--date=short",
		"--pretty=format:%x00%H%x1f%ad%x1f%an",
	]);

	const [commits, head] = await Promise.all([
		Promise.resolve(commitsOf(raw)),
		git(["rev-parse", "HEAD"]).then((sha) => sha.trim()),
	]);
	return shape(commits, head);
}

function commitsOf(raw: string): Commit[] {
	return raw
		.split(RECORD)
		.map(commitOf)
		.filter((commit): commit is Commit => commit !== null);
}

function commitOf(block: string): Commit | null {
	if (block.trim() === "") return null;
	const [header, ...lines] = block.split("\n");
	const [sha, date, author] = (header ?? "").split(FIELD);
	if (sha === undefined || date === undefined) return null;
	return { sha, date, author: author ?? "", touches: linesOf(lines) };
}

function linesOf(lines: string[]): Touch[] {
	return lines.flatMap((line) => {
		if (line.trim() === "") return [];
		const [added, deleted, path] = line.split("\t");
		return path === undefined
			? []
			: [
					{
						path,
						added: added === "-" ? 0 : Number(added),
						deleted: deleted === "-" ? 0 : Number(deleted),
					},
				];
	});
}

function shape(commits: Commit[], head: string): History {
	const dated = [...commits].sort((a, b) => a.date.localeCompare(b.date));
	const weeks = [...new Set(dated.map((commit) => weekOf(commit.date)))].sort();
	const weekAt = new Map(weeks.map((week, index) => [week, index]));
	const cutoff =
		weeks[Math.max(0, Math.floor(weeks.length * (1 - RECENT_SHARE)))];

	const stats = new Map<string, FileStats>();
	const perPackage = new Map<string, Series>();
	const perFile = new Map<string, Series>();
	const authors = new Set<string>();

	const blank = (): number[] => weeks.map(() => 0);
	const series = (into: Map<string, Series>, key: string): Series => {
		let held = into.get(key);
		if (held === undefined) {
			held = { key, counts: blank(), churn: blank() };
			into.set(key, held);
		}
		return held;
	};

	for (const commit of dated) {
		authors.add(commit.author);
		const at = weekAt.get(weekOf(commit.date)) ?? 0;
		accumulateCommit(commit, at, cutoff, stats, perPackage, perFile, series);
	}

	const files: FileHistory[] = [...stats].map(([path, held]) => ({
		path,
		pkg: packageOf(path),
		isTest: isTestPath(path),
		commits: held.commits,
		added: held.added,
		deleted: held.deleted,
		first: held.first,
		last: held.last,
		trend: trendOf(held.commits, held.recent),
	}));

	const ranked = (rows: Series[]): Series[] =>
		[...rows].sort(
			(a, b) =>
				b.counts.reduce((sum, n) => sum + n, 0) -
				a.counts.reduce((sum, n) => sum + n, 0),
		);

	return {
		head,
		commits: dated.length,
		authors: authors.size,
		files,
		timeline: {
			weeks,
			packages: ranked([...perPackage.values()]),
			files: ranked([...perFile.values()]).slice(0, 50),
		},
		cochange: cochange(dated, files),
	};
}

function accumulateCommit(
	commit: Commit,
	at: number,
	cutoff: string | undefined,
	stats: Map<string, FileStats>,
	perPackage: Map<string, Series>,
	perFile: Map<string, Series>,
	series: (into: Map<string, Series>, key: string) => Series,
): void {
	const touchedPackages = new Set<string>();
	for (const touch of commit.touches) {
		accumulateTouch(
			touch,
			commit.date,
			at,
			cutoff,
			stats,
			perPackage,
			perFile,
			series,
		);
		touchedPackages.add(packageOf(touch.path));
	}
	for (const pkg of touchedPackages) {
		const row = series(perPackage, pkg);
		row.counts[at] = (row.counts[at] ?? 0) + 1;
	}
}

function accumulateTouch(
	touch: Touch,
	date: string,
	at: number,
	cutoff: string | undefined,
	stats: Map<string, FileStats>,
	perPackage: Map<string, Series>,
	perFile: Map<string, Series>,
	series: (into: Map<string, Series>, key: string) => Series,
): void {
	const held = stats.get(touch.path) ?? {
		commits: 0,
		added: 0,
		deleted: 0,
		first: date,
		last: date,
		recent: 0,
	};
	held.commits += 1;
	held.added += touch.added;
	held.deleted += touch.deleted;
	held.first = held.first < date ? held.first : date;
	held.last = held.last > date ? held.last : date;
	if (cutoff !== undefined && date >= cutoff) held.recent += 1;
	stats.set(touch.path, held);

	const packageRow = series(perPackage, packageOf(touch.path));
	packageRow.churn[at] =
		(packageRow.churn[at] ?? 0) + touch.added + touch.deleted;
	const fileRow = series(perFile, touch.path);
	fileRow.counts[at] = (fileRow.counts[at] ?? 0) + 1;
	fileRow.churn[at] = (fileRow.churn[at] ?? 0) + touch.added + touch.deleted;
}

function trendOf(commits: number, recent: number): Trend {
	const expected = commits * RECENT_SHARE;
	if (expected === 0) return "stable";
	const ratio = recent / expected;
	if (ratio >= ACCELERATING) return "accelerating";
	return ratio <= COOLING ? "cooling" : "stable";
}

function pairsOf(
	commits: Commit[],
	keyOf: (path: string) => string | null,
	totals: Map<string, number>,
	limit: number,
): Pair[] {
	const together = new Map<string, number>();
	for (const commit of commits) {
		if (commit.touches.length > SWEEP_LIMIT) continue;
		const keys = [
			...new Set(
				commit.touches
					.map((touch) => keyOf(touch.path))
					.filter((key): key is string => key !== null),
			),
		].sort();
		for (let i = 0; i < keys.length; i++)
			for (let j = i + 1; j < keys.length; j++) {
				const key = `${keys[i]}\u0000${keys[j]}`;
				together.set(key, (together.get(key) ?? 0) + 1);
			}
	}

	return [...together]
		.map(([key, count]): Pair => {
			const [a, b] = key.split("\u0000");
			const aCommits = totals.get(a ?? "") ?? 0;
			const bCommits = totals.get(b ?? "") ?? 0;
			const floor = Math.min(aCommits, bCommits);
			return {
				a: a ?? "",
				b: b ?? "",
				together: count,
				aCommits,
				bCommits,
				strength: floor === 0 ? 0 : Number((count / floor).toFixed(3)),
			};
		})
		.filter((pair) => pair.together >= MIN_COCHANGE_COMMITS)
		.sort((a, b) => b.strength - a.strength || b.together - a.together)
		.slice(0, limit);
}

function cochange(
	commits: Commit[],
	files: FileHistory[],
): { files: Pair[]; packages: Pair[] } {
	const busy = new Map(
		files
			.filter((file) => file.commits >= MIN_COCHANGE_COMMITS)
			.map((file) => [file.path, file.commits]),
	);
	const packageTotals = new Map<string, number>();
	for (const commit of commits)
		for (const pkg of new Set(
			commit.touches.map((touch) => packageOf(touch.path)),
		))
			packageTotals.set(pkg, (packageTotals.get(pkg) ?? 0) + 1);

	return {
		files: pairsOf(
			commits,
			(path) => (busy.has(path) ? path : null),
			busy,
			120,
		),
		packages: pairsOf(
			commits,
			(path) => {
				const pkg = packageOf(path);
				return pkg === "root" ? null : pkg;
			},
			packageTotals,
			60,
		),
	};
}

export interface Churn {
	added: number;
	deleted: number;
	files: number;
}

export async function readChurn(): Promise<Map<string, Churn>> {
	const raw = await git([
		"log",
		"--no-merges",
		"--numstat",
		"--pretty=format:%x00%H",
	]);
	const churn = new Map<string, Churn>();
	for (const block of raw.split(RECORD)) {
		if (block.trim() === "") continue;
		const [sha, ...lines] = block.split("\n");
		if (sha === undefined) continue;
		const touches = linesOf(lines);
		churn.set(sha.trim(), {
			added: touches.reduce((sum, touch) => sum + touch.added, 0),
			deleted: touches.reduce((sum, touch) => sum + touch.deleted, 0),
			files: touches.length,
		});
	}
	return churn;
}
