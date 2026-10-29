import { distinctId } from "./analytics.tsx";
import { authToken } from "./auth-client.ts";

export async function apiHeaders(): Promise<Record<string, string>> {
	const id = distinctId();
	const token = await authToken();
	return {
		"content-type": "application/json",
		...(id ? { "x-distinct-id": id } : {}),
		...(token ? { authorization: `Bearer ${token}` } : {}),
	};
}
