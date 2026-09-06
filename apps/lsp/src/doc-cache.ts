import type { CallDoc } from "./call-diagnostics.ts";

export function cachedResolver(
	resolve: (name: string) => Promise<CallDoc>,
	ttlMs: number,
	now: () => number = Date.now,
): (name: string) => Promise<CallDoc> {
	const cache = new Map<string, { at: number; doc: CallDoc }>();
	return async (name: string): Promise<CallDoc> => {
		const t = now();
		const hit = cache.get(name);
		if (hit && t - hit.at < ttlMs) return hit.doc;
		const doc = await resolve(name);
		cache.set(name, { at: t, doc });
		return doc;
	};
}
