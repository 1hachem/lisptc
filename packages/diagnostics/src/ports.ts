import type { PromptSource } from "@repo/shared/host";

export interface DiagnosticsHost {
	prompt: PromptSource;
}

function qualifier(name: string): string {
	const at = name.lastIndexOf("/");
	return at < 0 ? "" : name.slice(0, at);
}

function base(name: string): string {
	const at = name.lastIndexOf("/");
	return at < 0 ? name : name.slice(at + 1);
}

function distance(a: string, b: string): number {
	let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
	for (let i = 1; i <= a.length; i++) {
		const row = [i];
		for (let j = 1; j <= b.length; j++)
			row.push(
				Math.min(
					previous[j] + 1,
					row[j - 1] + 1,
					previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
				),
			);
		previous = row;
	}
	return previous[b.length];
}

function tolerance(word: string): number {
	return Math.max(2, Math.floor(word.length / 3));
}

const MIN_SHARED = 3;

function shares(a: string, b: string): boolean {
	const [short, long] = a.length <= b.length ? [a, b] : [b, a];
	if (short.length < MIN_SHARED) return false;
	return long.startsWith(short) || long.endsWith(short);
}

export function nearest(
	name: string,
	candidates: Iterable<string>,
): string | undefined {
	const wanted = base(name);
	const where = qualifier(name);
	let extended: string | undefined;
	let extendedBy = Number.POSITIVE_INFINITY;
	let typo: string | undefined;
	let typoBy = Number.POSITIVE_INFINITY;
	for (const candidate of candidates) {
		if (candidate === name || qualifier(candidate) !== where) continue;
		const other = base(candidate);
		if (shares(wanted, other)) {
			const gap = Math.abs(other.length - wanted.length);
			if (gap < extendedBy) {
				extendedBy = gap;
				extended = candidate;
			}
			continue;
		}
		const apart = distance(wanted, other);
		if (apart < typoBy) {
			typoBy = apart;
			typo = candidate;
		}
	}
	if (extended !== undefined) return extended;
	return typoBy <= tolerance(wanted) ? typo : undefined;
}
