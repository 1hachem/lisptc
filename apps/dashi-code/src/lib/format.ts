const counts = new Intl.NumberFormat("en-US");
export function count(value: number): string {
	return counts.format(value);
}

export function when(at: number): string {
	return new Date(at).toLocaleString("en-US", {
		dateStyle: "medium",
		timeStyle: "short",
	});
}

export function basename(path: string): string {
	const cut = path.lastIndexOf("/");
	return cut < 0 ? path : path.slice(cut + 1);
}

export function shorten(path: string): string {
	return path.replace(/^packages\//, "");
}
