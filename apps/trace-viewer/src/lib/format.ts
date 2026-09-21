export function momentOf(startedAt: string): number | undefined {
	const iso = startedAt.replace(
		/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})$/,
		"$1T$2:$3:$4Z",
	);
	const at = new Date(iso).getTime();
	return Number.isNaN(at) ? undefined : at;
}

export function when(startedAt: string): string {
	const at = momentOf(startedAt);
	return at === undefined ? startedAt : moment(at);
}

export function day(at: number): string {
	return new Date(at).toLocaleDateString(undefined, {
		month: "short",
		day: "numeric",
	});
}

export function moment(at: number): string {
	return new Date(at).toLocaleString(undefined, {
		dateStyle: "medium",
		timeStyle: "short",
	});
}

export function duration(ms: number): string {
	return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}
