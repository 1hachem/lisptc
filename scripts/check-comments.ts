import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import ts from "typescript";

const DIRECTIVES = [
	/^\/\/\/\s*<reference/,
	/^\/\/\s*biome-ignore\b/,
	/^\/\/\s*@vitest-environment\b/,
	/^\/\/\s*@ts-(expect-error|ignore|nocheck)\b/,
	/^\/\*\s*@vite-ignore/,
	/^\/\/\s*#__PURE__/,
	/^\/\*\s*eslint-disable/,
];

const GENERATED = [/routeTree\.gen\.ts$/];

interface Found {
	pos: number;
	end: number;
	line: number;
	text: string;
	jsx?: { pos: number; end: number };
}

function tracked(): string[] {
	const out = execFileSync("git", ["ls-files", "*.ts", "*.tsx"], {
		encoding: "utf8",
	});
	return out
		.split("\n")
		.filter(Boolean)
		.filter((f) => !GENERATED.some((re) => re.test(f)));
}

function findComments(text: string, fileName: string): Found[] {
	const kind = fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
	const sf = ts.createSourceFile(
		fileName,
		text,
		ts.ScriptTarget.ESNext,
		true,
		kind,
	);

	const ranges = new Map<string, ts.CommentRange>();
	const emptyJsx: { pos: number; end: number }[] = [];

	const add = (rs: ts.CommentRange[] | undefined) => {
		if (rs) for (const r of rs) ranges.set(`${r.pos}:${r.end}`, r);
	};

	const walk = (node: ts.Node): void => {
		if (ts.isJsxExpression(node) && node.expression === undefined) {
			emptyJsx.push({ pos: node.getFullStart(), end: node.end });
		}
		const kids = node.getChildren(sf);
		if (kids.length === 0) {
			add(ts.getLeadingCommentRanges(text, node.pos));
			add(ts.getTrailingCommentRanges(text, node.end));
		}
		for (const kid of kids) walk(kid);
	};
	walk(sf);

	const found: Found[] = [];
	for (const r of [...ranges.values()].sort((a, b) => a.pos - b.pos)) {
		const raw = text.slice(r.pos, r.end);
		if (DIRECTIVES.some((re) => re.test(raw))) continue;
		found.push({
			pos: r.pos,
			end: r.end,
			line: text.slice(0, r.pos).split("\n").length,
			text: raw.split("\n")[0]?.trim() ?? "",
			jsx: emptyJsx.find((j) => r.pos >= j.pos && r.end <= j.end),
		});
	}
	return found;
}

function strip(text: string, found: Found[]): string {
	const cuts = found.map((f) => {
		const at = f.jsx ?? f;
		let start = at.pos;
		while (start > 0 && text[start - 1] !== "\n") start--;
		const aloneBefore = text.slice(start, at.pos).trim() === "";
		let stop = at.end;
		while (stop < text.length && text[stop] !== "\n") stop++;
		const aloneAfter = text.slice(at.end, stop).trim() === "";
		if (aloneBefore && aloneAfter)
			return { pos: start, end: Math.min(stop + 1, text.length) };
		if (aloneAfter) return { pos: at.pos, end: stop };
		return { pos: at.pos, end: at.end };
	});

	cuts.sort((a, b) => a.pos - b.pos);
	const merged: { pos: number; end: number }[] = [];
	for (const c of cuts) {
		const last = merged[merged.length - 1];
		if (last && c.pos <= last.end) last.end = Math.max(last.end, c.end);
		else merged.push({ ...c });
	}

	let out = text;
	for (let i = merged.length - 1; i >= 0; i--) {
		const c = merged[i];
		if (c) out = out.slice(0, c.pos) + out.slice(c.end);
	}
	return out.replace(/[ \t]+$/gm, "");
}

const fix = process.argv.includes("--fix");
const files = tracked();
const offenders: { file: string; found: Found[] }[] = [];

for (const file of files) {
	const text = readFileSync(file, "utf8");
	const found = findComments(text, file);
	if (found.length === 0) continue;
	offenders.push({ file, found });
	if (fix) writeFileSync(file, strip(text, found));
}

const total = offenders.reduce((n, o) => n + o.found.length, 0);

if (total === 0) {
	console.log(`No comments in ${files.length} files.`);
	process.exit(0);
}

if (fix) {
	console.log(`Removed ${total} comments from ${offenders.length} files.`);
	console.log("Run `pnpm format` to reflow, then review the diff.");
	process.exit(0);
}

for (const { file, found } of offenders) {
	for (const f of found) {
		const excerpt = f.text.length > 70 ? `${f.text.slice(0, 70)}…` : f.text;
		console.error(`${file}:${f.line}  ${excerpt}`);
	}
}
console.error("");
console.error(
	`${total} comment${total === 1 ? "" : "s"} in ${offenders.length} file${
		offenders.length === 1 ? "" : "s"
	}.`,
);
console.error("");
console.error("This repo's code carries no comments. If one of these states a");
console.error(
	"real constraint, move it to the devdocs/ page for that area (see",
);
console.error("devdocs/README.md); otherwise run `pnpm fix:comments` to strip");
console.error("them, then `pnpm format`.");
process.exit(1);
