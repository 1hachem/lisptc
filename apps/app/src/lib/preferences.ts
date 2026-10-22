import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { api } from "@repo/backend/api";
import { type QueryClient, useQuery } from "@tanstack/react-query";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { useCallback, useMemo, useSyncExternalStore } from "react";

export type StoredPreferences = FunctionReturnType<typeof api.preferences.get>;

type PreferencesChange = FunctionArgs<
	typeof api.preferences.put
>["preferences"];

export const preferencesQuery = convexQuery(api.preferences.get, {});

export function usePreferences(): StoredPreferences | undefined {
	return useQuery(preferencesQuery).data;
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

export function usePanelMotion() {
	const stored = usePreferences();
	const put = usePutPreferences();
	const setPanelMotion = useCallback(
		(on: boolean) => put({ panelMotion: on }),
		[put],
	);
	return { panelMotion: stored?.panelMotion ?? true, setPanelMotion };
}

export function useTraceBesideChat() {
	const stored = usePreferences();
	const put = usePutPreferences();
	const setTraceBesideChat = useCallback(
		(on: boolean) => put({ traceBesideChat: on }),
		[put],
	);
	return {
		traceBesideChat: stored?.traceBesideChat ?? false,
		setTraceBesideChat,
	};
}

export function useTraceLink() {
	const stored = usePreferences();
	const put = usePutPreferences();
	const setTraceLink = useCallback(
		(on: boolean) => put({ traceLink: on }),
		[put],
	);
	return { traceLink: stored?.traceLink ?? true, setTraceLink };
}

export function usePutPreferences() {
	const mutation = useConvexMutation(api.preferences.put);
	const put = useMemo(
		() =>
			mutation.withOptimisticUpdate((store, { preferences }) => {
				const current = store.getQuery(api.preferences.get, {});
				if (current === undefined) return;
				store.setQuery(
					api.preferences.get,
					{},
					{
						...current,
						...preferences,
						metadata: { ...current.metadata, ...preferences.metadata },
						input: { ...current.input, ...preferences.input },
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
