import { convexQuery } from "@convex-dev/react-query";
import { api } from "@repo/backend/api";
import { useQuery } from "@tanstack/react-query";

export function useVerticalOwner(): boolean {
	const { data } = useQuery(convexQuery(api.users.me, {}));
	return data?.verticalOwner === true;
}
