import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { api } from "@repo/backend/api";
import type { Id } from "@repo/backend/dataModel";
import { type QueryClient, useQuery } from "@tanstack/react-query";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useWorkspace } from "./workspace.tsx";

export type StoredPreferences = FunctionReturnType<typeof api.preferences.get>;

type PreferencesChange = FunctionArgs<
	typeof api.preferences.put
>["preferences"];

export function preferencesQuery(workspaceId: Id<"workspaces">) {
	return convexQuery(api.preferences.get, { workspaceId });
}

export function usePreferences(): StoredPreferences | undefined {
	const workspaceId = useWorkspace().workspace?._id;
	return useQuery(
		convexQuery(
			api.preferences.get,
			workspaceId === undefined ? "skip" : { workspaceId },
		),
	).data;
}

export function useCachedPreferences(
	queryClient: QueryClient,
	workspaceId: Id<"workspaces"> | undefined,
): StoredPreferences | undefined {
	const cached = () =>
		workspaceId === undefined
			? undefined
			: queryClient.getQueryData<StoredPreferences>(
					preferencesQuery(workspaceId).queryKey,
				);
	return useSyncExternalStore(
		(onChange) => queryClient.getQueryCache().subscribe(onChange),
		cached,
		cached,
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
	const workspaceId = useWorkspace().workspace?._id;
	const mutation = useConvexMutation(api.preferences.put);
	const put = useMemo(
		() =>
			mutation.withOptimisticUpdate((store, { workspaceId, preferences }) => {
				const current = store.getQuery(api.preferences.get, { workspaceId });
				if (current === undefined) return;
				store.setQuery(
					api.preferences.get,
					{ workspaceId },
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
		(change: PreferencesChange) => {
			if (workspaceId !== undefined)
				void put({ workspaceId, preferences: change });
		},
		[put, workspaceId],
	);
}
