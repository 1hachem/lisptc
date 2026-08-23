// Short-lived cache for a per-name doc resolver. `documents.onDidChangeContent`
// re-runs call-diagnostics/keyword-completion lookups on every keystroke, each
// resolving every distinct call name in the buffer -- without a cache this
// round-trips the shared session socket once per name on every edit. Mirrors
// the completions cache in server.ts (same CACHE_MS window), just keyed per
// name instead of holding one cached list.
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
