import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { api } from "@repo/backend/api";
import { type QueryClient, useQuery } from "@tanstack/react-query";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { useCallback, useMemo, useSyncExternalStore } from "react";

export type StoredPreferences = NonNullable<
	FunctionReturnType<typeof api.preferences.get>
>;

type PreferencesChange = FunctionArgs<
	typeof api.preferences.put
>["preferences"];

export const preferencesQuery = convexQuery(api.preferences.get, {});

export function usePreferences(): StoredPreferences | undefined {
	const { data } = useQuery(preferencesQuery);
	return data === undefined ? undefined : (data ?? {});
}

export function useCachedPreferences(
	queryClient: QueryClient,
): StoredPreferences | undefined {
	return useSyncExternalStore(
		(onChange) => queryClient.getQueryCache().subscribe(onChange),
		() => queryClient.getQueryData(preferencesQuery.queryKey) ?? undefined,
		() => queryClient.getQueryData(preferencesQuery.queryKey) ?? undefined,
	);
}

export function usePutPreferences() {
	const mutation = useConvexMutation(api.preferences.put);
	const put = useMemo(
		() =>
			mutation.withOptimisticUpdate((store, { preferences }) => {
				const current = store.getQuery(api.preferences.get, {});
				store.setQuery(
					api.preferences.get,
					{},
					{
						...current,
						...preferences,
					},
				);
			}),
		[mutation],
	);
	return useCallback(
		(change: PreferencesChange) => void put({ preferences: change }),
		[put],
	);
}
