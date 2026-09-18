const SEPARATORS = /[-_/]+/g;

function normalize(name: string): string {
	return name.toLowerCase().replace(SEPARATORS, "");
}

function tokens(name: string): string[] {
	return name.toLowerCase().split(SEPARATORS).filter(Boolean);
}

function distance(a: string, b: string): number {
	const cols = b.length + 1;
	let prev = Array.from({ length: cols }, (_, j) => j);
	for (let i = 1; i <= a.length; i++) {
		const curr = [i];
		for (let j = 1; j < cols; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
		}
		prev = curr;
	}
	return prev[cols - 1];
}

function subset(small: string[], big: string[]): boolean {
	const pool = new Set(big);
	return small.length > 0 && small.every((t) => pool.has(t));
}

const MAX_SUGGESTIONS = 3;

export function suggestNames(
	names: Iterable<string>,
	missing: string,
): string[] {
	const target = normalize(missing);
	if (target.length === 0) return [];
	const targetTokens = tokens(missing);
	const limit = Math.max(1, Math.floor(target.length / 4));
	const scored: { name: string; score: number }[] = [];
	for (const name of names) {
		if (name === missing) continue;
		const candidate = normalize(name);
		if (candidate.length === 0) continue;
		const nameTokens = tokens(name);
		let score: number;
		if (candidate === target) score = 0;
		else if (
			subset(targetTokens, nameTokens) ||
			subset(nameTokens, targetTokens)
		)
			score = 1 + Math.abs(candidate.length - target.length) / 1000;
		else {
			const d = distance(candidate, target);
			if (d > limit) continue;
			score = 5 + d;
		}
		scored.push({ name, score });
	}
	scored.sort((a, b) => a.score - b.score || a.name.localeCompare(b.name));
	return scored.slice(0, MAX_SUGGESTIONS).map((s) => s.name);
}
