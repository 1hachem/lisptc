const clamp = (value: number, low: number, high: number): number =>
	Math.max(low, Math.min(high, value));

export const scale =
	(d0: number, d1: number, r0: number, r1: number) =>
	(value: number): number =>
		d1 === d0 ? r0 : r0 + ((value - d0) / (d1 - d0)) * (r1 - r0);

export const area =
	(dmax: number, rmax: number) =>
	(value: number): number =>
		dmax <= 0 ? 0 : Math.sqrt(Math.max(value, 0) / dmax) * rmax;

export function ticks(d0: number, d1: number, count = 5): number[] {
	const span = d1 - d0 || 1;
	const magnitude = 10 ** Math.floor(Math.log10(span / count));
	const step =
		([1, 2, 2.5, 5, 10].find((m) => m * magnitude >= span / count) ?? 10) *
		magnitude;
	const out: number[] = [];
	for (let v = Math.ceil(d0 / step) * step; v <= d1 + 1e-9; v += step)
		out.push(Number(v.toFixed(10)));
	return out;
}

const QUANTS = 7;

export const quant = (t: number): string =>
	`var(--q${(clamp(Math.round(t * (QUANTS - 1)), 0, QUANTS - 1) + 1) * 100})`;

export const trendColor: Record<string, string> = {
	accelerating: "var(--crit)",
	stable: "var(--muted-plot)",
	cooling: "var(--s1)",
};

export function median(values: number[]): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function weeksBetween(first: string, last: string): string[] {
	const out: string[] = [];
	for (
		let at = Date.parse(`${first}T00:00:00Z`);
		at <= Date.parse(`${last}T00:00:00Z`);
		at += WEEK_MS
	)
		out.push(new Date(at).toISOString().slice(0, 10));
	return out;
}

export function weekLabel(week: string): string {
	return new Date(`${week}T00:00:00Z`).toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		timeZone: "UTC",
	});
}

export interface Tile<T> {
	item: T;
	value: number;
	x: number;
	y: number;
	w: number;
	h: number;
}

export function squarify<T>(
	items: { item: T; value: number }[],
	width: number,
	height: number,
): Tile<T>[] {
	const total = items.reduce((sum, item) => sum + item.value, 0);
	if (total <= 0) return [];
	const nodes = [...items]
		.filter((item) => item.value > 0)
		.sort((a, b) => b.value - a.value)
		.map((item) => ({ ...item, area: (item.value / total) * width * height }));

	const out: Tile<T>[] = [];
	let rect = { x: 0, y: 0, w: width, h: height };
	let row: typeof nodes = [];
	let index = 0;

	const worst = (candidate: typeof nodes, length: number): number => {
		const sum = candidate.reduce((total, node) => total + node.area, 0);
		const high = Math.max(...candidate.map((node) => node.area));
		const low = Math.min(...candidate.map((node) => node.area));
		return Math.max(
			(length * length * high) / (sum * sum),
			(sum * sum) / (length * length * low),
		);
	};

	const place = (candidate: typeof nodes, horizontal: boolean): void => {
		const sum = candidate.reduce((total, node) => total + node.area, 0);
		if (horizontal) {
			const h = sum / rect.w;
			let x = rect.x;
			for (const node of candidate) {
				const w = node.area / h;
				out.push({ item: node.item, value: node.value, x, y: rect.y, w, h });
				x += w;
			}
			rect = { x: rect.x, y: rect.y + h, w: rect.w, h: rect.h - h };
			return;
		}
		const w = sum / rect.h;
		let y = rect.y;
		for (const node of candidate) {
			const h = node.area / w;
			out.push({ item: node.item, value: node.value, x: rect.x, y, w, h });
			y += h;
		}
		rect = { x: rect.x + w, y: rect.y, w: rect.w - w, h: rect.h };
	};

	while (index < nodes.length) {
		const horizontal = rect.w >= rect.h;
		const length = horizontal ? rect.w : rect.h;
		const next = [...row, nodes[index] as (typeof nodes)[number]];
		if (row.length === 0 || worst(next, length) <= worst(row, length)) {
			row = next;
			index += 1;
		} else {
			place(row, horizontal);
			row = [];
		}
		if (index === nodes.length && row.length > 0) {
			place(row, rect.w >= rect.h);
			row = [];
		}
	}
	return out;
}
