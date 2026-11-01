export interface DiffLine {
	kind: "same" | "removed" | "added";
	text: string;
}

function commonSuffixLengths(a: string[], b: string[]): number[][] {
	const table = Array.from({ length: a.length + 1 }, () =>
		new Array<number>(b.length + 1).fill(0),
	);
	for (let i = a.length - 1; i >= 0; i--)
		for (let j = b.length - 1; j >= 0; j--)
			table[i][j] =
				a[i] === b[j]
					? table[i + 1][j + 1] + 1
					: Math.max(table[i + 1][j], table[i][j + 1]);
	return table;
}

export function lineDiff(before: string, after: string): DiffLine[] {
	const a = before.split("\n");
	const b = after.split("\n");
	const table = commonSuffixLengths(a, b);
	const lines: DiffLine[] = [];
	let i = 0;
	let j = 0;
	while (i < a.length || j < b.length) {
		if (i < a.length && j < b.length && a[i] === b[j]) {
			lines.push({ kind: "same", text: a[i] });
			i++;
			j++;
		} else if (
			i < a.length &&
			(j === b.length || table[i + 1][j] >= table[i][j + 1])
		) {
			lines.push({ kind: "removed", text: a[i] });
			i++;
		} else {
			lines.push({ kind: "added", text: b[j] });
			j++;
		}
	}
	return lines;
}
