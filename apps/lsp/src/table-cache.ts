export function cachedFor<T>(
	load: () => Promise<T>,
	ttlMs: number,
	now: () => number = Date.now,
): () => Promise<T> {
	let hit: { at: number; value: Promise<T> } | undefined;
	return () => {
		const t = now();
		if (hit && t - hit.at < ttlMs) return hit.value;
		const value = load();
		hit = { at: t, value };
		value.catch(() => {
			if (hit?.value === value) hit = undefined;
		});
		return value;
	};
}
