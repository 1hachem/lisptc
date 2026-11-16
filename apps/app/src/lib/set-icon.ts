import { useConvexMutation } from "@convex-dev/react-query";
import { api } from "@repo/backend/api";
import { useMemo } from "react";

export function useSetIcon() {
	const mutation = useConvexMutation(api.workspaces.setIcon);
	return useMemo(
		() =>
			mutation.withOptimisticUpdate((store, { workspaceId, icon }) => {
				const list = store.getQuery(api.workspaces.list, {});
				if (list !== undefined) {
					store.setQuery(
						api.workspaces.list,
						{},
						list.map((candidate) =>
							candidate._id === workspaceId
								? { ...candidate, icon }
								: candidate,
						),
					);
				}
				const single = store.getQuery(api.workspaces.get, { workspaceId });
				if (single !== undefined) {
					store.setQuery(
						api.workspaces.get,
						{ workspaceId },
						{ ...single, icon },
					);
				}
			}),
		[mutation],
	);
}
