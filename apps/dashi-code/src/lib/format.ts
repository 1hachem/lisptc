const counts = new Intl.NumberFormat("en-US");
const compact = new Intl.NumberFormat("en-US", {
	notation: "compact",
	maximumFractionDigits: 1,
});

export function count(value: number): string {
	return counts.format(value);
}

export function short(value: number): string {
	return compact.format(value);
}

export function percent(value: number): string {
	return `${value.toFixed(1)}%`;
}

export function when(at: number): string {
	return new Date(at).toLocaleString("en-US", {
		dateStyle: "medium",
		timeStyle: "short",
	});
}

export function where(path: string, line: number | null | undefined): string {
	return line === null || line === undefined ? path : `${path}:${line}`;
}

export function basename(path: string): string {
	const cut = path.lastIndexOf("/");
	return cut < 0 ? path : path.slice(cut + 1);
}

export function shorten(path: string): string {
	return path.replace(/^packages\//, "");
}
