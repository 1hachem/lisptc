export function when(startedAt: string): string {
	const iso = startedAt.replace(
		/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})$/,
		"$1T$2:$3:$4Z",
	);
	const at = new Date(iso);
	if (Number.isNaN(at.getTime())) return startedAt;
	return at.toLocaleString(undefined, {
		dateStyle: "medium",
		timeStyle: "short",
	});
}

export function duration(ms: number): string {
	return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}
