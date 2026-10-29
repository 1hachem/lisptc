import { useCallback, useEffect, useMemo } from "react";

const REFRESH_BEFORE_EXPIRY_MS = 60_000;

export interface TokenCache {
	get(force: boolean): Promise<string | null>;
	peek(): string | null;
	clear(): void;
}

function expiryOf(token: string): number | undefined {
	const payload = token.split(".")[1];
	if (payload === undefined) return undefined;
	try {
		const { exp } = JSON.parse(
			atob(payload.replace(/-/g, "+").replace(/_/g, "/")),
		) as { exp?: unknown };
		return typeof exp === "number" ? exp * 1000 : undefined;
	} catch {
		return undefined;
	}
}

export function tokenCache(
	fetchToken: () => Promise<string | null>,
	now: () => number,
	seed?: string,
): TokenCache {
	let token: string | null = seed ?? null;
	let pending: Promise<string | null> | undefined;

	const fresh = (): boolean => {
		if (token === null) return false;
		const expiry = expiryOf(token);
		return expiry !== undefined && now() < expiry - REFRESH_BEFORE_EXPIRY_MS;
	};

	return {
		get(force) {
			if (!force && fresh()) return Promise.resolve(token);
			if (pending !== undefined) return pending;
			const request = fetchToken()
				.then((value) => {
					if (pending === request) token = value;
					return value;
				})
				.catch(() => null)
				.finally(() => {
					if (pending === request) pending = undefined;
				});
			pending = request;
			return request;
		},
		peek: () => token,
		clear() {
			token = null;
			pending = undefined;
		},
	};
}

export interface SessionSource {
	useSession(): {
		data: { session?: { id: string } | null } | null;
		isPending: boolean;
	};
}

export function convexAuthHook(source: SessionSource, cache: TokenCache) {
	return function useConvexAuthFromSession() {
		const { data, isPending } = source.useSession();
		const signedIn = Boolean(data?.session);
		const seeded = cache.peek() !== null;

		useEffect(() => {
			if (!isPending && !signedIn) cache.clear();
		}, [isPending, signedIn]);

		const fetchAccessToken = useCallback(
			({ forceRefreshToken = false }: { forceRefreshToken?: boolean } = {}) =>
				cache.get(forceRefreshToken),
			[],
		);

		const authenticated = signedIn || (isPending && seeded);
		const loading = isPending && !seeded;

		return useMemo(
			() => ({
				isLoading: loading,
				isAuthenticated: authenticated,
				fetchAccessToken,
			}),
			[loading, authenticated, fetchAccessToken],
		);
	};
}
